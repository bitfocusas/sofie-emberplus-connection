import {
	NumberedTreeNode,
	EmberElement,
	NumberedTreeNodeImpl,
	EmberNodeImpl,
	ParameterImpl,
	ParameterType,
	QualifiedElementImpl,
} from '../../../model'
import { ElementType } from '../../../model/EmberElement'
import { Collection, Root, RootElement } from '../../../types/types'
import { EmberClient } from '../'
import S101ClientMock from '../../../__mocks__/S101Client'
import { DecodeResult } from '../../../encodings/ber/decoder/DecodeResult'
import { berDecode } from '../../../encodings/ber'
import { Parameter, ParameterAccess } from '../../../model/Parameter'
// import { EmberTreeNode, RootElement } from '../../../types/types'
// import { ElementType, EmberElement } from '../../../model/EmberElement'
// import { Parameter, ParameterType } from '../../../model/Parameter'

jest.mock('../../Socket/S101Client', () => require('../../../__mocks__/S101Client'))

describe('client', () => {
	const onSocketCreate = jest.fn()
	const onConnection = jest.fn()
	const onSocketClose = jest.fn()
	const onSocketWrite = jest.fn()
	const onConnectionChanged = jest.fn()

	function setupSocketMock() {
		S101ClientMock.mockOnNextSocket((socket: any) => {
			onSocketCreate()

			socket.onConnect = onConnection
			socket.onWrite = onSocketWrite
			socket.onClose = onSocketClose
		})
	}

	beforeEach(() => {
		setupSocketMock()
	})
	afterEach(() => {
		const sockets = S101ClientMock.openSockets()
		// Destroy any lingering sockets, to prevent a failing test from affecting other tests:
		sockets.forEach((s) => s.destroy())

		S101ClientMock.clearMockOnNextSocket()
		onSocketCreate.mockClear()
		onConnection.mockClear()
		onSocketClose.mockClear()
		onSocketWrite.mockClear()
		onConnectionChanged.mockClear()

		// Just a check to ensure that the unit tests cleaned up the socket after themselves:
		// eslint-disable-next-line jest/no-standalone-expect
		expect(sockets).toHaveLength(0)
	})

	async function runWithConnection(fn: (connection: EmberClient, socket: S101ClientMock) => Promise<void>) {
		const client = new EmberClient('test')
		try {
			expect(client).toBeTruthy()

			await client.connect()

			// Wait for connection
			await new Promise(setImmediate)

			// Should be connected
			expect(client.connected).toBeTruthy()

			const sockets = S101ClientMock.openSockets()
			expect(sockets).toHaveLength(1)
			expect(onSocketWrite).toHaveBeenCalledTimes(0)

			await fn(client, sockets[0])
		} finally {
			// Ensure cleaned up
			await client.disconnect()
			client.discard()

			await new Promise(setImmediate)
		}
	}

	function createQualifiedNodeResponse(
		path: string,
		content: EmberElement,
		children: Collection<NumberedTreeNode<EmberElement>>
	): DecodeResult<Root> {
		const parent = new QualifiedElementImpl<EmberElement>(path, content, children)

		const fixLevel = (node: NumberedTreeNode<EmberElement>, parent: NumberedTreeNode<EmberElement>) => {
			node.parent = parent

			for (const child of Object.values<NumberedTreeNode<EmberElement>>(node.children ?? {})) {
				fixLevel(child, node)
			}
		}
		for (const child of Object.values<NumberedTreeNode<EmberElement>>(children)) {
			fixLevel(child, parent as any as NumberedTreeNode<EmberElement>)
		}
		return {
			value: {
				0: parent as Exclude<RootElement, NumberedTreeNode<EmberElement>>,
			},
		}
	}

	it('getDirectory resolves', async () => {
		await runWithConnection(async (client, socket) => {
			// Do initial load
			const getRootDirReq = await client.getDirectory(client.tree)
			getRootDirReq.response?.catch(() => null) // Ensure uncaught response is ok
			expect(onSocketWrite).toHaveBeenCalledTimes(1)
			// TODO: should the value of the call be checked?

			// Mock a valid response
			socket.mockData({
				value: {
					1: new NumberedTreeNodeImpl(1, new EmberNodeImpl('Ruby', undefined, undefined, true)),
				},
			})

			// Should have a response
			const res = (await getRootDirReq.response) as NumberedTreeNodeImpl<EmberElement>
			expect(res).toMatchObject(new NumberedTreeNodeImpl(1, new EmberNodeImpl('Ruby', undefined, undefined, true)))
		})
	})

	it('getElementByPath', async () => {
		await runWithConnection(async (client, socket) => {
			// Do initial load
			const getRootDirReq = await client.getDirectory(client.tree)
			getRootDirReq.response?.catch(() => null) // Ensure uncaught response is ok
			expect(onSocketWrite).toHaveBeenCalledTimes(1)
			onSocketWrite.mockClear()

			// Mock a valid response
			socket.mockData({
				value: {
					1: new NumberedTreeNodeImpl(1, new EmberNodeImpl('Ruby', undefined, undefined, true)),
				},
			})
			await getRootDirReq.response

			// Run the tree
			const getByPathPromise = client.getElementByPath('Ruby.Sums.On')

			// First lookup
			expect(onSocketWrite).toHaveBeenCalledTimes(1)
			socket.mockData({
				value: {
					1: new NumberedTreeNodeImpl(1, new EmberNodeImpl('Ruby', undefined, undefined, true), {
						1: new NumberedTreeNodeImpl(1, new EmberNodeImpl('Sums', undefined, undefined, true)),
					}),
				},
			})

			await new Promise(setImmediate)

			// Second lookup
			expect(onSocketWrite).toHaveBeenCalledTimes(2)
			socket.mockData({
				value: {
					1: new QualifiedElementImpl<EmberElement>('1.1', new EmberNodeImpl('Sums', undefined, undefined, false), {
						1: new NumberedTreeNodeImpl(1, new ParameterImpl(ParameterType.Boolean, 'On', undefined, false)),
					}) as Exclude<RootElement, NumberedTreeNode<EmberElement>>,
				},
			})

			await new Promise(setImmediate)

			const res = await getByPathPromise
			expect(res).toBeTruthy()
			expect(res).toMatchObject(
				new NumberedTreeNodeImpl(1, new ParameterImpl(ParameterType.Boolean, 'On', undefined, false))
			)
		})
	})

	/**
	 * Bootstraps a tree containing a single Parameter at path "1.1" whose
	 * descriptor fields (identifier, description, access, isOnline, …) are
	 * all populated, then runs `body` with the resolved NumberedTreeNode and
	 * the most recently sent BER buffer's decoded root.
	 */
	async function runSetValueScenario(
		paramType: ParameterType,
		setValueArg: unknown,
		body: (decodedRoot: { contents?: Record<string, unknown>; path?: string }) => void
	) {
		await runWithConnection(async (client, socket) => {
			const getRootDirReq = await client.getDirectory(client.tree)
			getRootDirReq.response?.catch(() => null)
			onSocketWrite.mockClear()
			socket.mockData({
				value: {
					1: new NumberedTreeNodeImpl(1, new EmberNodeImpl('Root', undefined, undefined, true)),
				},
			})
			await getRootDirReq.response

			const getByPath = client.getElementByPath('Root.Param')
			socket.mockData(
				createQualifiedNodeResponse('1', new EmberNodeImpl('Root', undefined, undefined, true), {
					1: new NumberedTreeNodeImpl(
						1,
						new ParameterImpl(
							paramType,
							'Param',
							'A parameter whose descriptor should not leak',
							undefined,
							undefined,
							undefined,
							ParameterAccess.ReadWrite,
							'%lld',
							undefined,
							undefined,
							true
						)
					),
				})
			)
			await new Promise(setImmediate)

			const param = (await getByPath) as NumberedTreeNode<Parameter>
			expect(param).toBeTruthy()

			onSocketWrite.mockClear()
			await client.setValue(param, setValueArg as never, false)

			expect(onSocketWrite).toHaveBeenCalledTimes(1)
			const sentBuffer: Buffer = onSocketWrite.mock.calls[0][0]
			const decoded = berDecode(sentBuffer)
			const root = Object.values<{ contents?: Record<string, unknown>; path?: string }>(
				decoded.value as Record<number, { contents?: Record<string, unknown>; path?: string }>
			)[0] as { contents?: Record<string, unknown>; path?: string }
			body(root)
		})
	}

	/**
	 * Asserts that the decoded outgoing setValue payload contains no
	 * descriptor leakage. `parameterType` is ignored because the decoder
	 * always synthesises it from the BER value tag — its presence is fine
	 * and indeed expected; we care that everything else is absent.
	 */
	function expectMinimalContents(root: { contents?: Record<string, unknown>; path?: string }) {
		const definedKeys = Object.entries<unknown>(root.contents ?? {})
			.filter(([k, v]) => v !== undefined && k !== 'parameterType')
			.map(([k]) => k)
			.sort()
		expect(definedKeys).toEqual(['type', 'value'])
		expect((root.contents as unknown as Parameter).type).toBe(ElementType.Parameter)
		expect(root.path).toBe('1.1')
	}

	it('setValue sends a minimal value-only QualifiedParameter (string)', async () => {
		await runSetValueScenario(ParameterType.String, 'v=0\r\no=- 0 0 IN IP4 0.0.0.0\r\n', (root) => {
			expectMinimalContents(root)
			expect((root.contents as unknown as Parameter).parameterType).toBe(ParameterType.String)
			expect((root.contents as unknown as Parameter).value).toBe('v=0\r\no=- 0 0 IN IP4 0.0.0.0\r\n')
		})
	})

	it('setValue sends a minimal value-only QualifiedParameter (integer)', async () => {
		await runSetValueScenario(ParameterType.Integer, 42, (root) => {
			expectMinimalContents(root)
			expect((root.contents as unknown as Parameter).parameterType).toBe(ParameterType.Integer)
			expect((root.contents as unknown as Parameter).value).toBe(42)
		})
	})

	it('setValue sends a minimal value-only QualifiedParameter (real)', async () => {
		await runSetValueScenario(ParameterType.Real, 3.14159, (root) => {
			expectMinimalContents(root)
			expect((root.contents as unknown as Parameter).parameterType).toBe(ParameterType.Real)
			expect((root.contents as unknown as Parameter).value).toBeCloseTo(3.14159, 5)
		})
	})

	it('setValue sends a minimal value-only QualifiedParameter (boolean)', async () => {
		await runSetValueScenario(ParameterType.Boolean, true, (root) => {
			expectMinimalContents(root)
			expect((root.contents as unknown as Parameter).parameterType).toBe(ParameterType.Boolean)
			expect((root.contents as unknown as Parameter).value).toBe(true)
		})
	})

	it('setValue sends a minimal value-only QualifiedParameter (enum)', async () => {
		// On the wire, Enum and Integer share the BER INTEGER tag, so the
		// decoder reports Integer here. That's fine — the provider knows
		// from its own descriptor that the parameter is an enum.
		await runSetValueScenario(ParameterType.Enum, 2, (root) => {
			expectMinimalContents(root)
			expect((root.contents as unknown as Parameter).parameterType).toBe(ParameterType.Integer)
			expect((root.contents as unknown as Parameter).value).toBe(2)
		})
	})

	it('setValue sends a minimal value-only QualifiedParameter (octets)', async () => {
		const payload = Buffer.from([0xde, 0xad, 0xbe, 0xef])
		await runSetValueScenario(ParameterType.Octets, payload, (root) => {
			expectMinimalContents(root)
			expect((root.contents as unknown as Parameter).parameterType).toBe(ParameterType.Octets)
			expect((root.contents as unknown as Parameter).value).toEqual(payload)
		})
	})

	it('setValue sends a minimal value-only QualifiedParameter (null)', async () => {
		await runSetValueScenario(ParameterType.Null, null, (root) => {
			expectMinimalContents(root)
			expect((root.contents as unknown as Parameter).parameterType).toBe(ParameterType.Null)
			expect((root.contents as unknown as Parameter).value).toBeNull()
		})
	})

	it('setValue accepts an already-qualified element and still sends a minimal payload', async () => {
		await runWithConnection(async (client) => {
			const qualified = new QualifiedElementImpl<Parameter>(
				'1.2.3',
				new ParameterImpl(
					ParameterType.Integer,
					'Gain',
					'Channel gain',
					0,
					100,
					-100,
					ParameterAccess.ReadWrite,
					undefined,
					undefined,
					undefined,
					true
				)
			)

			onSocketWrite.mockClear()
			await client.setValue(qualified as never, 7, false)

			expect(onSocketWrite).toHaveBeenCalledTimes(1)
			const sentBuffer: Buffer = onSocketWrite.mock.calls[0][0]
			const decoded = berDecode(sentBuffer)
			const root = Object.values<{ contents?: Record<string, unknown>; path?: string }>(
				decoded.value as Record<number, { contents?: Record<string, unknown>; path?: string }>
			)[0] as { contents?: Record<string, unknown>; path?: string }

			const definedKeys = Object.entries<unknown>(root.contents ?? {})
				.filter(([k, v]) => v !== undefined && k !== 'parameterType')
				.map(([k]) => k)
				.sort()
			expect(definedKeys).toEqual(['type', 'value'])
			expect(root.path).toBe('1.2.3')
			expect((root.contents as unknown as Parameter).value).toBe(7)

			// Local cache reflects the new value.
			expect(qualified.contents.value).toBe(7)
			// And, crucially, descriptor fields on the cached element are untouched.
			expect(qualified.contents.identifier).toBe('Gain')
			expect(qualified.contents.access).toBe(ParameterAccess.ReadWrite)
			expect(qualified.contents.isOnline).toBe(true)
		})
	})

	it('getElementByPath concurrent', async () => {
		await runWithConnection(async (client, socket) => {
			// Do initial load
			const getRootDirReq = await client.getDirectory(client.tree)
			getRootDirReq.response?.catch(() => null) // Ensure uncaught response is ok
			expect(onSocketWrite).toHaveBeenCalledTimes(1)
			onSocketWrite.mockClear()

			// Mock a valid response
			socket.mockData({
				value: {
					1: new NumberedTreeNodeImpl(1, new EmberNodeImpl('Ruby', undefined, undefined, true)),
				},
			})
			await getRootDirReq.response

			// Run the tree
			const getByPathPromise = client.getElementByPath('Ruby.Sums.MAIN.On')
			const getByPathPromise2 = client.getElementByPath('Ruby.Sums.MAIN.Second')

			// First lookup from both
			expect(onSocketWrite).toHaveBeenCalledTimes(2)
			socket.mockData(
				createQualifiedNodeResponse('1', new EmberNodeImpl('Ruby', undefined, undefined, true), {
					1: new NumberedTreeNodeImpl(1, new EmberNodeImpl('Sums', undefined, undefined, false)),
				})
			)

			socket.mockData(
				createQualifiedNodeResponse('1', new EmberNodeImpl('Ruby', undefined, undefined, true), {
					1: new NumberedTreeNodeImpl(1, new EmberNodeImpl('Sums', undefined, undefined, false)),
				})
			)

			await new Promise(setImmediate)

			// Second lookup
			expect(onSocketWrite).toHaveBeenCalledTimes(4)
			socket.mockData(
				createQualifiedNodeResponse('1.1', new EmberNodeImpl('Sums', undefined, undefined, false), {
					1: new NumberedTreeNodeImpl(1, new EmberNodeImpl('MAIN', undefined, undefined, false)),
				})
			)
			await new Promise(setImmediate)
			socket.mockData(
				createQualifiedNodeResponse('1.1', new EmberNodeImpl('Sums', undefined, undefined, false), {
					1: new NumberedTreeNodeImpl(1, new EmberNodeImpl('MAIN', undefined, undefined, false)),
				})
			)

			await new Promise(setImmediate)

			// Final lookup
			expect(onSocketWrite).toHaveBeenCalledTimes(6)
			socket.mockData(
				createQualifiedNodeResponse('1.1.1', new EmberNodeImpl('MAIN', undefined, undefined, false), {
					1: new NumberedTreeNodeImpl(1, new ParameterImpl(ParameterType.Boolean, 'On', undefined, false)),
					2: new NumberedTreeNodeImpl(1, new ParameterImpl(ParameterType.Boolean, 'Second', undefined, false)),
				})
			)

			// Both completed successfully
			const res = await getByPathPromise
			expect(res).toBeTruthy()

			const res2 = await getByPathPromise2
			expect(res2).toBeTruthy()
		})
	})
})

import {
	NumberedTreeNode,
	EmberElement,
	NumberedTreeNodeImpl,
	EmberNodeImpl,
	ParameterImpl,
	Parameter,
	ParameterType,
	ElementType,
	QualifiedElementImpl,
} from '../../../model'
import { Collection, Root, RootElement } from '../../../types/types'
import { EmberClient } from '../'
import S101ClientMock from '../../../__mocks__/S101Client'
import { DecodeResult } from '../../../encodings/ber/decoder/DecodeResult'
import { berDecode } from '../../../encodings/ber'
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
		children: Collection<NumberedTreeNode<EmberElement>> | undefined
	): DecodeResult<Root> {
		const parent = new QualifiedElementImpl<EmberElement>(path, content, children)

		const fixLevel = (node: NumberedTreeNode<EmberElement>, parent: NumberedTreeNode<EmberElement>) => {
			node.parent = parent

			for (const child of Object.values<NumberedTreeNode<EmberElement>>(node.children ?? {})) {
				fixLevel(child, node)
			}
		}
		if (children) {
			for (const child of Object.values<NumberedTreeNode<EmberElement>>(children)) {
				fixLevel(child, parent as any as NumberedTreeNode<EmberElement>)
			}
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

	it('setValue sends sparse update for template-governed parameters', async () => {
		await runWithConnection(async (client) => {
			const templatedParam = new NumberedTreeNodeImpl(1, {
				type: ElementType.Parameter,
				parameterType: ParameterType.String,
				identifier: 'SDP',
				value: 'old value',
				templateReference: '1.6.4',
			})

			await client.setValue(templatedParam, 'new value', false)

			expect(onSocketWrite).toHaveBeenCalledTimes(1)
			const sentBuffer = onSocketWrite.mock.calls[0][0] as Buffer
			const sendOptions = onSocketWrite.mock.calls[0][1] as { dtdMinorVersion?: number } | undefined
			const decoded = berDecode(sentBuffer)
			const rootElements = decoded.value as Collection<RootElement>
			const sentElement = Object.values<RootElement>(rootElements)[0]

			expect('path' in sentElement).toBeTruthy()
			if (!('path' in sentElement)) throw new Error('Expected a qualified element')

			expect(sentElement.path).toBe('1')
			expect(sentElement.contents.type).toBe('PARAMETER')
			expect((sentElement.contents as ParameterImpl).value).toBe('new value')
			expect((sentElement.contents as ParameterImpl).identifier).toBeUndefined()
			expect((sentElement.contents as ParameterImpl).access).toBeUndefined()
			expect((sentElement.contents as ParameterImpl).isOnline).toBeUndefined()
			expect((sentElement.contents as ParameterImpl).parameterType).toBe(ParameterType.String)
			expect(sendOptions).toEqual({ dtdMinorVersion: 0x28 })
		})
	})

	it('setValue for template-governed parameter generates a minimal BER payload', async () => {
		await runWithConnection(async (client) => {
			const templatedParam = new QualifiedElementImpl<Parameter>('1.2.3', {
				type: ElementType.Parameter,
				parameterType: ParameterType.Integer,
				identifier: 'Volume',
				description: 'Main Volume',
				value: 50,
				minimum: 0,
				maximum: 100,
				isOnline: true,
				templateReference: '1.1.1',
			})

			await client.setValue(templatedParam, 75, false)

			expect(onSocketWrite).toHaveBeenCalledTimes(1)
			const sentBuffer = onSocketWrite.mock.calls[0][0] as Buffer
			const sendOptions = onSocketWrite.mock.calls[0][1] as { dtdMinorVersion?: number } | undefined
			const decoded = berDecode(sentBuffer)
			const rootElements = decoded.value as Collection<RootElement>
			const sentElement = Object.values<RootElement>(rootElements)[0]

			expect('path' in sentElement).toBeTruthy()
			if (!('path' in sentElement)) throw new Error('Expected a qualified element')

			const contents = sentElement.contents as ParameterImpl
			expect(sentElement.path).toBe('1.2.3')
			expect(contents.value).toBe(75)
			expect(contents.identifier).toBeUndefined()
			expect(contents.description).toBeUndefined()
			expect(contents.access).toBeUndefined()
			expect(contents.minimum).toBeUndefined()
			expect(contents.maximum).toBeUndefined()
			expect(contents.parameterType).toBe(ParameterType.Integer)
			expect(contents.templateReference).toBeUndefined()
			expect(contents.isOnline).toBeUndefined()
			expect(sendOptions).toEqual({ dtdMinorVersion: 0x28 })
		})
	})

	it('setValue keeps default glow version for non-template parameters', async () => {
		await runWithConnection(async (client) => {
			const regularParam = new NumberedTreeNodeImpl(1, {
				type: ElementType.Parameter,
				parameterType: ParameterType.String,
				identifier: 'PlainParam',
				value: 'old value',
			})

			await client.setValue(regularParam, 'new value', false)

			expect(onSocketWrite).toHaveBeenCalledTimes(1)
			const sendOptions = onSocketWrite.mock.calls[0][1] as { dtdMinorVersion?: number } | undefined
			expect(sendOptions).toBeUndefined()
		})
	})
})

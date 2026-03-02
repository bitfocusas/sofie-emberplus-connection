import type { EmberElement } from '../model/EmberElement'
import type { EmberFunction } from '../model/EmberFunction'
import { ParameterType } from '../model/Parameter'
import type { Parameter } from '../model/Parameter'
import type { Template } from '../model/Template'
import type { Matrix } from '../model/Matrix'
import type { EmberNode } from '../model/EmberNode'
import type { StreamEntry } from '../model/StreamEntry'
import type { InvocationResult } from '../model/InvocationResult'
import type { TreeElement, NumberedTreeNode, QualifiedElement } from '../model/Tree'

export type {
	TreeElement,
	NumberedTreeNode,
	QualifiedElement,
	EmberTreeNode,
	EmberValue,
	EmberTypedValue,
	Root,
	RootElement,
	MinMax,
	StringIntegerCollection,
	RelativeOID,
	Collection,
}
export { RootType, literal }

type EmberTreeNode<T extends EmberElement> = NumberedTreeNode<T>
type RootElement =
	| NumberedTreeNode<EmberElement>
	| QualifiedElement<Parameter>
	| QualifiedElement<EmberNode>
	| QualifiedElement<Matrix>
	| QualifiedElement<EmberFunction>
	| QualifiedElement<Template>
type Root = Collection<RootElement> | Collection<StreamEntry> | InvocationResult

enum RootType {
	Elements,
	Streams,
	InvocationResult,
}

// number is either Integer64 or REAL
type EmberValue = number | string | boolean | Buffer | null
interface EmberTypedValue {
	type: ParameterType
	value: EmberValue
}

type MinMax = number | null
type StringIntegerCollection = Map<string, number>
type RelativeOID = string

function literal<T>(arg: T): T {
	return arg
}

type Collection<T> = { [index: number]: T }

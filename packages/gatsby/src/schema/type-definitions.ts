import { GraphQLResolveInfo } from "graphql"

import { IPhantomReporter } from "gatsby-cli/lib/reporter"

import { IGraphQLRunnerStats } from "../query/types"

export interface IGatsbyResolverContext<TSource, TArgs> {
  defaultFieldResolver: GatsbyResolver<TSource, TArgs>
  nodeModel: any
  stats: IGraphQLRunnerStats | null
  activity: IPhantomReporter
  [key: string]: any
}

export type GatsbyGraphQLResolveInfo = GraphQLResolveInfo & {
  from?: string
  fromNode?: string
}

export type GatsbyResolver<TSource, TArgs = { [argName: string]: any }> = (
  source: TSource,
  args: TArgs,
  context: IGatsbyResolverContext<TSource, TArgs>,
  info: GatsbyGraphQLResolveInfo
) => any

export interface IGatsbyConnection<NodeType> {
  totalCount: number
  edges: Array<IGatsbyEdge<NodeType>>
  nodes: Array<NodeType>
  pageInfo: IGatsbyPageInfo
}

export interface IGatsbyEdge<NodeType> {
  node: NodeType
  next: NodeType | undefined
  previous: NodeType | undefined
}

export interface IGatsbyPageInfo {
  currentPage: number
  hasPreviousPage: boolean
  hasNextPage: boolean
  itemCount: number
  pageCount: number
  perPage: number | undefined
}

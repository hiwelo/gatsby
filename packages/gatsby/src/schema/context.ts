import { GraphQLSchema } from "graphql"
import { SchemaComposer } from "graphql-compose"

import { IPhantomReporter } from "gatsby-cli/lib/reporter"

import { createPageDependency } from "../redux/actions/add-page-dependency"

import { LocalNodeModel } from "./node-model"
import { defaultFieldResolver } from "./resolvers"
import { IGraphQLRunnerStats } from "../query/types"
import { IGatsbyResolverContext } from "./type-definitions"

export default function withResolverContext<TSource, TArgs>({
  schema,
  schemaComposer,
  context,
  customContext,
  nodeModel,
  stats,
  activity,
}: {
  schema: GraphQLSchema
  schemaComposer: SchemaComposer<IGatsbyResolverContext<TSource, TArgs>>
  context: Record<string, any>
  customContext: Record<string, any>
  nodeModel: any
  stats: IGraphQLRunnerStats | null
  activity: IPhantomReporter
}): IGatsbyResolverContext<TSource, TArgs> {
  const nodeStore = require(`../db/nodes`)

  if (!nodeModel) {
    nodeModel = new LocalNodeModel({
      nodeStore,
      schema,
      schemaComposer,
      createPageDependency,
    })
  }

  return {
    ...(context || {}),
    ...(customContext || {}),
    defaultFieldResolver,
    nodeModel: nodeModel.withContext({
      path: context ? context.path : undefined,
    }),
    stats,
    activity,
  }
}

module.exports = withResolverContext

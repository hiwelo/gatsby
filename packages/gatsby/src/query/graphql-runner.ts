import crypto from "crypto"
import v8 from "v8"
import {
  parse,
  validate,
  execute,
  DocumentNode,
  GraphQLSchema,
  Source,
  GraphQLError,
  ExecutionResult,
} from "graphql"
import { Path } from "graphql/jsutils/Path"
import { debounce } from "lodash"
import report, {
  IPhantomReporter,
  IActivityArgs,
} from "gatsby-cli/lib/reporter"
import * as nodeStore from "../db/nodes"
import { createPageDependency } from "../redux/actions/add-page-dependency"

import withResolverContext from "../schema/context"
import { LocalNodeModel } from "../schema/node-model"
import { Store } from "redux"
import { IGatsbyState } from "../redux/types"
import { IGraphQLRunnerStatResults, IGraphQLRunnerStats } from "./types"

type Query = string | Source

export default class GraphQLRunner {
  parseCache: Map<Query, DocumentNode>

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  nodeModel: any // TODO: convert "../schema/node-model" from Flow

  schema: GraphQLSchema

  validDocuments: WeakSet<DocumentNode>
  scheduleClearCache: () => void

  stats: IGraphQLRunnerStats | null

  constructor(
    protected store: Store<IGatsbyState>,
    {
      collectStats,
    }: {
      collectStats?: boolean
    } = {}
  ) {
    const { schema, schemaCustomization } = this.store.getState()

    this.nodeModel = new LocalNodeModel({
      nodeStore,
      schema,
      schemaComposer: schemaCustomization.composer,
      createPageDependency,
    })
    this.schema = schema
    this.parseCache = new Map()
    this.validDocuments = new WeakSet()
    this.scheduleClearCache = debounce(this.clearCache.bind(this), 5000)

    if (collectStats) {
      this.stats = {
        totalQueries: 0,
        uniqueOperations: new Set(),
        uniqueQueries: new Set(),
        totalRunQuery: 0,
        totalPluralRunQuery: 0,
        totalIndexHits: 0,
        totalSiftHits: 0,
        totalNonSingleFilters: 0,
        comparatorsUsed: new Map(),
        uniqueFilterPaths: new Set(),
        uniqueSorts: new Set(),
      }
    } else {
      this.stats = null
    }
  }

  clearCache(): void {
    this.parseCache.clear()
    this.validDocuments = new WeakSet()
  }

  parse(query: Query): DocumentNode {
    if (!this.parseCache.has(query)) {
      this.parseCache.set(query, parse(query))
    }
    return this.parseCache.get(query) as DocumentNode
  }

  validate(
    schema: GraphQLSchema,
    document: DocumentNode
  ): readonly GraphQLError[] {
    if (!this.validDocuments.has(document)) {
      const errors = validate(schema, document)
      if (!errors.length) {
        this.validDocuments.add(document)
      }
      return errors as Array<GraphQLError>
    }
    return []
  }

  getStats(): IGraphQLRunnerStatResults | null {
    if (this.stats) {
      const comparatorsUsedObj: Array<{
        comparator: string
        amount: number
      }> = []
      this.stats.comparatorsUsed.forEach((value, key) => {
        comparatorsUsedObj.push({ comparator: key, amount: value })
      })
      return {
        totalQueries: this.stats.totalQueries,
        uniqueOperations: this.stats.uniqueOperations.size,
        uniqueQueries: this.stats.uniqueQueries.size,
        totalRunQuery: this.stats.totalRunQuery,
        totalPluralRunQuery: this.stats.totalPluralRunQuery,
        totalIndexHits: this.stats.totalIndexHits,
        totalSiftHits: this.stats.totalSiftHits,
        totalNonSingleFilters: this.stats.totalNonSingleFilters,
        comparatorsUsed: comparatorsUsedObj,
        uniqueFilterPaths: this.stats.uniqueFilterPaths.size,
        uniqueSorts: this.stats.uniqueSorts.size,
      }
    } else {
      return null
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query(
    query: Query,
    context: Record<string, any>,
    { parentSpan, queryName }: IActivityArgs & { queryName: string } = {
      queryName: ``,
    }
  ): Promise<ExecutionResult> {
    const { schema, schemaCustomization } = this.store.getState()

    if (this.schema !== schema) {
      this.schema = schema
      this.clearCache()
    }

    if (this.stats) {
      this.stats.totalQueries++
      let statsQuery = query
      if (typeof statsQuery !== `string`) {
        statsQuery = statsQuery.body
      }
      this.stats.uniqueOperations.add(
        crypto
          .createHash(`sha1`)
          .update(statsQuery)
          .update(v8.serialize(context))
          .digest(`hex`)
      )

      this.stats.uniqueQueries.add(
        crypto.createHash(`sha1`).update(statsQuery).digest(`hex`)
      )
    }

    const document = this.parse(query)
    const errors = this.validate(schema, document)

    const activity = new GraphQLSpanTracker(`GraphQL Query ${queryName}`, {
      parentSpan: parentSpan,
    })

    const result =
      errors.length > 0
        ? { errors }
        : execute({
            schema,
            document,
            rootValue: context,
            contextValue: withResolverContext({
              schema,
              schemaComposer: schemaCustomization.composer,
              context,
              customContext: schemaCustomization.context,
              nodeModel: this.nodeModel,
              stats: this.stats,
              activity,
            }),
            variableValues: context,
          })

    // Queries are usually executed in batch. But after the batch is finished
    // cache just wastes memory without much benefits.
    // TODO: consider a better strategy for cache purging/invalidation
    this.scheduleClearCache()
    return Promise.resolve(result)
  }
}

/**
 * Tracks and knows how to get a parent span for a particular
 *  point in query resolver for a particular query and path
 */
class GraphQLSpanTracker {
  parentSpan: IPhantomReporter
  spans: Map<string, IPhantomReporter>

  constructor(name: string, activityArgs: IActivityArgs) {
    this.parentSpan = report.phantomActivity(name, activityArgs)
    this.spans = new Map()
  }

  start(): void {
    this.parentSpan.start()
  }

  finish(): void {
    this.parentSpan.finish()
  }

  createGraphQLActivity(path: Path, name: string): IPhantomReporter {
    let prev: Path | undefined = path.prev
    while (prev && typeof prev.key === `number`) {
      prev = prev.prev
    }
    const parentSpan = this.getSpan(prev)
    const span = report.phantomActivity(name, { parentSpan })
    this.setSpan(path, span)
    return {
      span,

      start(): void {
        span.start()
      },

      finish(): void {
        span.finish()
      },
    }
  }

  getSpan(gqlPath: Path | undefined): IPhantomReporter {
    const path = pathToArray(gqlPath)
    if (path.length > 0) {
      return this.spans.get(path.join(`.`))
    } else {
      return this.parentSpan
    }
  }

  setSpan(gqlPath: Path, span: IPhantomReporter): void {
    const path = pathToArray(gqlPath)
    this.spans.set(path.join(`.`), span)
  }
}

const pathToArray = (path: Path | undefined): Array<string | number> => {
  const flattened: Array<string | number> = []
  let curr: Path | undefined = path
  while (curr) {
    flattened.push(curr.key)
    curr = curr.prev
  }
  return flattened.reverse()
}

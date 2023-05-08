#!/usr/bin/env node
import 'source-map-support/register';
import { App } from 'aws-cdk-lib'
import { PrismaAppSyncStack } from '../lib/stacks/prisma-appsync-stack';
import { join } from 'path'
import { AmplifyExportedBackend } from '@aws-amplify/cdk-exported-backend';
import * as path from 'path'
import { mergeSchema } from '../lib/module/mergeGraphqlSchema';
import { ResolverStack } from '../lib/stacks/resolver-stack';


const app = new App();

// lLoad Config
const argContext = 'env';
const envName = app.node.tryGetContext(argContext);
if (envName == undefined)
    throw new Error(`Please specify environment with context option. ex) cdk deploy -c env={envName}`);

const appVals = app.node.tryGetContext("app");
if (appVals == undefined) throw new Error('Invalid environment.');
const fullEnvName = `${appVals['name']}${envName}`;

// merge schema
mergeSchema();

const amplifyStack = new AmplifyExportedBackend(app, `${fullEnvName}AmplifyExportedBackend`, {
    path: path.resolve(__dirname, '..', './lib/amplify-export-backend'),
    amplifyEnvironment: "dev"
});
const graphqlApi = amplifyStack.graphqlNestedStacks().graphQLAPI();
//const graphQLSchema = amplifyStack.graphqlNestedStacks().graphQLSchema();


const prismaAppSyncStack = new PrismaAppSyncStack(app, `${fullEnvName}PrismaAppSyncStack`, {
    resourcesPrefix: `${fullEnvName}PrismaAppSync`,
    function: {
        code: join(process.cwd(), 'cdk/lambda/prisma-appsync-handler.ts'),
        memorySize: 512,
        useWarmUp: 0, // useWarmUp > 0 will incur extra costs
        environment: {
            NODE_ENV: 'production',
            DATABASE_URL: process.env.DATABASE_URL,
        },
        bundling: {
            minify: true,
            sourceMap: true,
            forceDockerBundling: false,
            commandHooks: {
                beforeBundling(inputDir: string, outputDir: string): string[] {
                    const schemaPath = join(process.cwd(), 'prisma/schema.prisma');
                    return [`cp ${schemaPath} ${outputDir}`];
                },
                beforeInstall() {
                    return []
                },
                afterBundling() {
                    return [
                        'npx prisma generate',
                        'rm -rf generated',

                        // npm + yarn 1.x
                        'rm -rf node_modules/@prisma/engines',
                        'rm -rf node_modules/@prisma/client/node_modules',
                        'rm -rf node_modules/.bin',
                        'rm -rf node_modules/prisma',
                        'rm -rf node_modules/prisma-appsync',
                    ]
                },
            },
            nodeModules: ['prisma', '@prisma/client', 'prisma-appsync'],
            environment: {
                NODE_ENV: 'production',
            },
        },
    },
    graphqlApi: graphqlApi
})

new ResolverStack(app, `${fullEnvName}ResolverStack`, {
    resourcesPrefix: `${fullEnvName}PrismaAppSync`,
    schema: join(process.cwd(), 'prisma/generated/merged-schema.graphql'),
    resolvers: join(process.cwd(), 'prisma/generated/prisma-appsync/resolvers.yaml'),
    graphqlApi: graphqlApi,
    dataSources: prismaAppSyncStack.dataSources
});

app.synth()
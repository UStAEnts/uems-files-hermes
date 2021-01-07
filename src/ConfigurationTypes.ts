import * as z from "zod";
import { Options } from "amqplib";

/**
 * A schema describing the settings for a database connection. Settings is left loosly typed but is meant to represent
 * {@link MongoClientOptions} but it is an equal loose type apparently as it accepts this type.
 */
export const MongoDBConfigurationSchema = z.object({
    username: z.string(),
    password: z.string(),
    uri: z.string(),
    port: z.number(),
    server: z.string(),
    database: z.string(),
    collections: z.object({
        details: z.string(),
        changelog: z.string(),
    }),
    settings: z.object({}).nonstrict().optional(),
});


const OptionType: z.ZodType<Options.Connect> = z.any().optional();

/**
 * The schem which should be used to validate messaging configurations before casting them
 */
export const MessagingConfigurationSchema = z.object({
    options: OptionType,
    gateway: z.string(),
    request: z.string(),
    inbox: z.string(),
    topics: z.array(z.string()),
});

export const UploadConfigurationSchema = z.object({
    uploadPath: z.string().optional(),
    maxSize: z.number().optional(),
    mimeList: z.array(z.string()).optional(),
    mimeType: z.enum(['WHITELIST', 'BLACKLIST']).optional(),
    port: z.number().optional(),
    domain: z.string(),
})

export type UploadConfiguration = z.infer<typeof UploadConfigurationSchema>;

export const ConfigurationSchema = z.object({
    message: MessagingConfigurationSchema,
    database: MongoDBConfigurationSchema,
    upload: UploadConfigurationSchema,
});

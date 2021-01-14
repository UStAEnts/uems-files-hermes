import { Collection, Db, ObjectId } from "mongodb";
import { GenericMongoDatabase, MongoDBConfiguration } from "@uems/micro-builder";
import { FileMessage, FileResponse } from "@uems/uemscommlib";
import ReadFileMessage = FileMessage.ReadFileMessage;
import CreateFileMessage = FileMessage.CreateFileMessage;
import DeleteFileMessage = FileMessage.DeleteFileMessage;
import UpdateFileMessage = FileMessage.UpdateFileMessage;
import InternalFile = FileResponse.InternalFile;
import { UploadServerInterface } from "../uploader/UploadServer";
import ShallowInternalFile = FileResponse.ShallowInternalFile;
import { MongoDBConfigurationSchema } from "../ConfigurationTypes";
import { genericDelete, genericUpdate } from "@uems/micro-builder/build/utility/GenericDatabaseFunctions";

export type DatabaseFile = ShallowInternalFile & {
    filePath: string,
    events: string[],
}

const databaseToShallow = (file: DatabaseFile): ShallowInternalFile => ({
    owner: file.owner,
    mime: file.mime,
    date: file.date,
    id: file.id,
    name: file.name,
    size: file.size,
    type: file.type,
    filename: file.filename,
    downloadURL: file.downloadURL,
});

export class FileDatabase extends GenericMongoDatabase<ReadFileMessage, CreateFileMessage, DeleteFileMessage, UpdateFileMessage, ShallowInternalFile> {

    private _server: UploadServerInterface;

    constructor(_configuration: MongoDBConfiguration, server: UploadServerInterface); // (1)
    constructor(_configurationOrDB: MongoDBConfiguration | Db, collections: MongoDBConfiguration["collections"], server: UploadServerInterface); // (2)
    constructor(database: Db, collections: MongoDBConfiguration["collections"], server: UploadServerInterface); // (3)

    constructor(_configuration: MongoDBConfiguration | Db, collections?: MongoDBConfiguration["collections"] | UploadServerInterface, server?: UploadServerInterface) { // (4)
        super(_configuration, collections as MongoDBConfiguration['collections']);
        if (MongoDBConfigurationSchema.check(_configuration)) {
            if (MongoDBConfigurationSchema.shape.collections.check(collections)) {
                if (server !== undefined) {
                    // In this case its (2)
                    this._server = server;
                } else {
                    throw new Error('invalid construction');
                }
            } else if (server === undefined && collections !== undefined) {
                // In this case its (1)
                this._server = collections;
            } else {
                throw new Error('invalid construction');
            }
        } else {
            // In this case its (3)
            if (server !== undefined) {
                this._server = server;
            } else {
                throw new Error('invalid construction')
            }
        }

        this._server.setResolver(async (filename) => {
            if (this._details === undefined) throw new Error('database not initialised');

            console.log('looking for', filename);
            const result = await this._details.findOne({
                filePath: filename,
            });
            console.log('got', result);

            return result.filename;
        });

        if (this._details === undefined) throw new Error('Database initialisation failed');
        void this._details.createIndex({ name: 'text', filename: 'text' });
    }

    protected createImpl = async (create: FileMessage.CreateFileMessage, details: Collection): Promise<string[]> => {
        const { msg_id, msg_intention, status, ...document } = create;

        const createObject: Omit<DatabaseFile, 'id' | 'downloadURL' | 'filePath' | 'mime'> = {
            filename: document.filename,
            type: document.type,
            size: document.size,
            name: document.name,
            date: Date.now(),
            owner: document.userid,
            events: [],
        }

        const result = await details.insertOne(createObject);

        if (result.insertedCount !== 1 || result.insertedId === undefined) {
            throw new Error('failed to insert')
        }

        const id = (result.insertedId as ObjectId).toHexString();
        await this.log(id, 'inserted');

        const uploadURI = await this._server.provisionUploadURI({
            date: Date.now(),
            id,
            name: create.name,
            size: create.size,
            // @ts-ignore - arrrrgh
            owner: create.userid,
            type: create.type,
            filename: create.filename,
            mime: '',
        }, async (filePath, fileName, mime) => {

            const answer = await details.updateOne({
                _id: new ObjectId(id),
            }, {
                $set: {
                    filePath,
                    filename: fileName,
                    mime,
                }
            });

            if (answer.modifiedCount !== 1) {
                throw new Error('Failed to update');
            }
        });

        return [id, uploadURI];
    }

    protected deleteImpl(remove: FileMessage.DeleteFileMessage, details: Collection): Promise<string[]> {
        if (!ObjectId.isValid(remove.id)) throw new Error('Invalid ID');
        return genericDelete({
            _id: new ObjectId(remove.id),
        }, remove.id, details, this.log.bind(this));
    }

    protected async queryImpl(query: FileMessage.ReadFileMessage, details: Collection): Promise<ShallowInternalFile[]> {
        const find: Record<string, unknown> = {};

        // IDs have to be treated as object IDs
        if (query.id) {
            if (!ObjectId.isValid(query.id)) throw new Error('invalid query id');
            find._id = new ObjectId(query.id);
        }

        // For now group all the text fields into one and perform a full text search.
        // This might not work properly, we'll need to see
        const text = [];
        for (const entry of ['name', 'filename'] as (keyof ReadFileMessage)[]) {
            if (query[entry] !== undefined) text.push(query[entry]);
        }

        if (text.length > 0) {
            // TODO: find a way to search by column rather than relying on a single text index
            find.$text = {
                $search: text.join(' '),
            }
        }

        // Copy all remaining search properties into the query if they have been specified
        const remainingProperties = [
            'size', 'type', 'date'
        ] as (keyof ReadFileMessage)[];

        for (const entry of remainingProperties) {
            if (query[entry] !== undefined) {
                find[entry] = query[entry];
            }
        }

        // User vs UserID
        if (query.userid) {
            find.owner = query.userid;
        }

        const result: DatabaseFile[] = await details.find(find).toArray();
        const promises: Promise<void>[] = [];
        // Copy _id to id to fit the responsr type.
        for (const r of result) {
            // @ts-ignore
            r.id = r._id.toString();

            promises.push(
                this._server.generateDownloadURI(r).then((url) => {
                    // @ts-ignore
                    r.downloadURL = url;
                })
            )

            // @ts-ignore
            delete r._id;
        }

        await Promise.all(promises);

        return result.map((s) => databaseToShallow(s));
    }

    protected updateImpl(update: FileMessage.UpdateFileMessage, details: Collection): Promise<string[]> {
        return genericUpdate(update, ['name', 'type'], details)
    }

    public async addFilesToEvents(eventID: string, fileIDs: string[]): Promise<boolean> {
        if (this._details === undefined) throw new Error('database not initialised');

        const result = await this._details.updateMany({
            _id: {
                $in: fileIDs.map((e) => new ObjectId(e)),
            }
        }, {
            $addToSet: {
                events: eventID,
            }
        });

        if (result.result.ok !== 1) {
            throw new Error('failed to update bindings');
        }

        return true;
    }

    public async addEventsToFile(fileID: string, eventIDs: string[]): Promise<boolean> {
        if (this._details === undefined) throw new Error('database not initialised');
        if (!ObjectId.isValid(fileID)) throw new Error('invalid file ID');

        const result = await this._details.updateOne({
            _id: new ObjectId(fileID),
        }, {
            $addToSet: {
                events: {
                    $each: eventIDs,
                },
            },
        });

        if (result.result.ok !== 1) {
            throw new Error('failed to update bindings');
        }

        return true;
    }

    public async removeFilesFromEvents(eventID: string, fileIDs: string[]): Promise<boolean> {
        if (this._details === undefined) throw new Error('database not initialised');

        const result = await this._details.updateMany({
            _id: {
                $in: fileIDs.map((e) => new ObjectId(e)),
            }
        }, {
            $pull: {
                events: eventID,
            }
        });

        if (result.result.ok !== 1) {
            throw new Error('failed to update bindings');
        }

        return true;
    }

    public async removeEventsFromFile(fileID: string, eventIDs: string[]): Promise<boolean> {
        if (this._details === undefined) throw new Error('database not initialised');
        if (!ObjectId.isValid(fileID)) throw new Error('invalid file ID');

        const result = await this._details.updateOne({
            _id: new ObjectId(fileID),
        }, {
            $pullAll: {
                events: eventIDs,
            }
        })

        if (result.result.ok !== 1) {
            throw new Error('failed to update bindings');
        }

        return true;
    }

    public async setFilesForEvent(eventID: string, fileIDs: string[]): Promise<boolean> {
        if (this._details === undefined) throw new Error('database not initialised');

        // Going to do this in two steps
        // - Remove event ID from all files
        // - Add event ID to the given files

        const result = await this._details.updateMany({
            // TODO: double check this
            events: eventID,
        }, {
            $pull: {
                events: eventID,
            }
        })

        if (result.result.ok !== 1) {
            throw new Error('failed to update bindings');
        }

        return this.addFilesToEvents(eventID, fileIDs);
    }

    public async setEventsForFile(fileID: string, eventIDs: string[]): Promise<boolean> {
        if (this._details === undefined) throw new Error('database not initialised');
        if (!ObjectId.isValid(fileID)) throw new Error('invalid file ID');

        const result = await this._details.updateOne({
            _id: new ObjectId(fileID),
        }, {
            $set: {
                events: eventIDs,
            }
        })

        if (result.result.ok !== 1) {
            throw new Error('failed to update bindings');
        }

        return true;
    }

    public async getFilesForEvent(eventID: string): Promise<string[]> {
        if (this._details === undefined) throw new Error('database not initialised');

        const result = await this._details.find({
            events: eventID,
        }).toArray();

        return (result ?? []).map((e) => e._id.toHexString());
    }

    public async getEventsForFile(fileID: string): Promise<string[]> {
        if (this._details === undefined) throw new Error('database not initialised');
        if (!ObjectId.isValid(fileID)) throw new Error('invalid file ID');

        const result = await this._details.findOne({
            _id: new ObjectId(fileID)
        });
        return result.events ?? [];
    }

}

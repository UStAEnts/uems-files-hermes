import { Collection, ObjectId } from "mongodb";
import { GenericMongoDatabase, MongoDBConfiguration } from "@uems/micro-builder";
import { FileMessage, FileResponse } from "@uems/uemscommlib";
import ReadFileMessage = FileMessage.ReadFileMessage;
import CreateFileMessage = FileMessage.CreateFileMessage;
import DeleteFileMessage = FileMessage.DeleteFileMessage;
import UpdateFileMessage = FileMessage.UpdateFileMessage;
import InternalFile = FileResponse.InternalFile;
import { UploadServerInterface } from "../uploader/UploadServer";
import ShallowInternalFile = FileResponse.ShallowInternalFile;

export type DatabaseFile = InternalFile & {
    filePath: string,
}

export class FileDatabase extends GenericMongoDatabase<ReadFileMessage, CreateFileMessage, DeleteFileMessage, UpdateFileMessage, ShallowInternalFile> {

    private _server: UploadServerInterface;

    constructor(configuration: MongoDBConfiguration, server: UploadServerInterface) {
        super(configuration);
        this._server = server;
    }

    protected createImpl = async (create: FileMessage.CreateFileMessage, details: Collection): Promise<string[]> => {
        const { msg_id, msg_intention, status, ...document } = create;

        // Move userid to owner
        // @ts-ignore
        document.owner = document.userid;
        // @ts-ignore
        delete document.userid;
        // @ts-ignore
        document.date = Date.now();

        const result = await details.insertOne(document);

        if (result.insertedCount !== 1 || result.insertedId === undefined) {
            throw new Error('failed to insert')
        }

        const id = (result.insertedId as ObjectId).toHexString();
        await super.log(id, 'inserted');

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

    protected deleteImpl(remove: FileMessage.DeleteFileMessage): Promise<string[]> {
        return super.defaultDelete(remove);
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

        // Now lets strip out any unknown properties!
        const allowedProps = ['id', 'name', 'filename', 'size', 'mime', 'owner', 'type', 'date', 'downloadURL'];
        result.forEach((e) => {
            for (const key of Object.keys(e)) {
                if (!allowedProps.includes(key)) {
                    console.log('removing key', key);
                    // @ts-ignore
                    delete e[key];
                }
            }
        });

        await Promise.all(promises);

        // TODO: find a better way to handle this, use an explicit convertor
        return result as unknown as ShallowInternalFile[];
    }

    protected updateImpl(update: FileMessage.UpdateFileMessage): Promise<string[]> {
        return super.defaultUpdate(update)
    }

}

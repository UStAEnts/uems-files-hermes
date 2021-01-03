import { Collection, ObjectId } from "mongodb";
import { GenericMongoDatabase } from "@uems/micro-builder";
import { FileMessage, FileResponse } from "@uems/uemscommlib";
import ReadFileMessage = FileMessage.ReadFileMessage;
import CreateFileMessage = FileMessage.CreateFileMessage;
import DeleteFileMessage = FileMessage.DeleteFileMessage;
import UpdateFileMessage = FileMessage.UpdateFileMessage;
import InternalFile = FileResponse.InternalFile;

export class FileDatabase extends GenericMongoDatabase<ReadFileMessage, CreateFileMessage, DeleteFileMessage, UpdateFileMessage, InternalFile> {

    protected async createImpl(create: FileMessage.CreateFileMessage, details: Collection): Promise<string[]> {
        const { msg_id, msg_intention, status, ...document } = create;

        const result = await details.insertOne(document);

        if (result.insertedCount !== 1 || result.insertedId === undefined) {
            throw new Error('failed to insert')
        }

        const id = (result.insertedId as ObjectId).toHexString();
        await super.log(id, 'inserted');

        return [id];
    }

    protected deleteImpl(remove: FileMessage.DeleteFileMessage): Promise<string[]> {
        return super.defaultDelete(remove);
    }

    protected async queryImpl(query: FileMessage.ReadFileMessage, details: Collection): Promise<InternalFile[]> {
        const find: Record<string, unknown> = {};

        // IDs have to be treated as object IDs
        if (query.id) {
            if (!ObjectId.isValid(query.id)) throw new Error('invalid query id');
            find._id = new ObjectId(query.id);
        }

        // For now group all the text fields into one and perform a full text search.
        // This might not work properly, we'll need to see
        const text = [];
        for (const entry of ['name', 'filename'] as (keyof ReadFileMessage)[]){
            if (query[entry] !== undefined) text.push(query[entry]);
        }

        if (text.length > 0){
            // TODO: find a way to search by column rather than relying on a single text index
            find.$text = {
                $search: text.join(' '),
            }
        }

        // Copy all remaining search properties into the query if they have been specified
        const remainingProperties = [
            'size', 'type', 'date'
        ] as (keyof ReadFileMessage)[];

        for (const entry of remainingProperties){
            if (query[entry] !== undefined){
                find[entry] = query[entry];
            }
        }

        // User vs UserID
        if (query.userid){
            find.user = query.userid;
        }

        const result: InternalFile[] = await details.find(find).toArray();

        // Copy _id to id to fit the responsr type.
        for (const r of result) {
            // @ts-ignore
            r.id = r._id.toString();

            // @ts-ignore
            delete r._id;
        }

        return result;
    }

    protected updateImpl(update: FileMessage.UpdateFileMessage): Promise<string[]> {
        return super.defaultUpdate(update)
    }

}

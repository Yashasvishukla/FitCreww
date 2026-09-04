import { AzurePrivateBlobStorage, MemoryPrivateBlobStorage, type PrivateBlobStorage } from '@fitcrew/db/media-pipeline';

// Development sink only. Production must bind this port to Azure Blob Storage.
const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
export const mediaStorage: PrivateBlobStorage = connectionString && process.env.AZURE_STORAGE_CONTAINER
  ? new AzurePrivateBlobStorage(connectionString, process.env.AZURE_STORAGE_CONTAINER)
  : new MemoryPrivateBlobStorage();

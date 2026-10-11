import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

// Load models (registers schemas).
import '../src/models/index.js';

let mongo;

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  process.env.MONGODB_URI = 'mongodb://127.0.0.1:0/test';
  process.env.DISCORD_TOKEN = 'test';
  process.env.DISCORD_CLIENT_ID = 'test';
  process.env.DISCORD_GUILD_ID = 'test';
  process.env.ROBLOX_GROUP_ID = 'test';

  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri(), { dbName: 'guard24-test' });
});

afterEach(async () => {
  const collections = mongoose.connection.collections;
  for (const name of Object.keys(collections)) {
    await collections[name].deleteMany({});
  }
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});
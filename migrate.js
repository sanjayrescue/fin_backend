import { MongoClient } from "mongodb";

const localUri = "mongodb://127.0.0.1:27017/fintech_auth"; 
const atlasUri = "mongodb+srv://sanjaygawai:12345@cluster0.tiyza.mongodb.net/";

const localClient = new MongoClient(localUri);
const atlasClient = new MongoClient(atlasUri);

async function migrate() {
  try {
    await localClient.connect();
    await atlasClient.connect();

    const localDB = localClient.db("fintech_auth");
    const atlasDB = atlasClient.db("fintech_auth");

    // List of collections you want to migrate
    const collections = ["users", "applications", "targets", "payouts", "banners", "followups"];

    for (const name of collections) {
      console.log(`⏳ Migrating collection: ${name}`);

      const data = await localDB.collection(name).find().toArray();

      if (data.length > 0) {
        await atlasDB.collection(name).deleteMany({}); // optional: clear old data
        await atlasDB.collection(name).insertMany(data);
        console.log(`✅ Migrated ${data.length} docs from local.${name} → atlas.${name}`);
      } else {
        console.log(`⚠️ No data found in local.${name}`);
      }
    }

    console.log("🎉 Migration complete!");
  } catch (err) {
    console.error("❌ Migration failed:", err);
  } finally {
    await localClient.close();
    await atlasClient.close();
  }
}

migrate();

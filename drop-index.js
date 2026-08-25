const mongoose = require('mongoose');

async function dropIndex() {
  try {
    await mongoose.connect('mongodb+srv://mohsinahmed22022_db_user:WS5JzIVFEiEN1k7c@scaleup.kblzvbw.mongodb.net/tenet');
    console.log('Connected to MongoDB');
    const db = mongoose.connection.db;
    const collection = db.collection('products');
    await collection.dropIndex('slug_1');
    console.log('Successfully dropped old slug_1 index');
  } catch (error) {
    if (error.codeName === 'IndexNotFound') {
      console.log('Index slug_1 already dropped or not found');
    } else {
      console.error('Error dropping index:', error.message);
    }
  } finally {
    mongoose.disconnect();
  }
}

dropIndex();

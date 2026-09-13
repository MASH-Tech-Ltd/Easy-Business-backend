const mongoose = require('mongoose');
const url = 'mongodb+srv://mohsinahmed22022_db_user:WS5JzIVFEiEN1k7c@scaleup.kblzvbw.mongodb.net/tenet';

async function run() {
  await mongoose.connect(url);
  const Courier = mongoose.model('Courier', new mongoose.Schema({}, { strict: false }));
  const couriers = await Courier.find();
  console.log(JSON.stringify(couriers, null, 2));
  mongoose.disconnect();
}
run();

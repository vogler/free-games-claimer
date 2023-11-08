import { existsSync } from 'fs';
import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import { datetime } from './util.js';

const datetime_UTCtoLocalTimezone = async file => {
  if (!existsSync(file)) return console.error('File does not exist:', file);
  const db = new Low(new JSONFile(file));
  await db.read();
  db.data ||= {};
  console.log('Migrating', file);
  for (const user in db.data) {
    for (const game in db.data[user]) {
      const time1 = db.data[user][game].time;
      const time1s = time1.endsWith('Z') ? time1 : time1 + ' UTC';
      const time2 = datetime(new Date(time1s));
      console.log([game, time1, time2]);
      db.data[user][game].time = time2;
    }
  }
  // console.log(db.data);
  await db.write(); // write out json db
};

const args = process.argv.slice(2);
if (args[0] == 'localtime') {
  const files = args.slice(1);
  console.log('Will convert UTC datetime to local timezone for', files);
  files.forEach(datetime_UTCtoLocalTimezone);
} else {
  console.log('Usage: node migrate.js <cmd> <args>');
  console.log('       node migrate.js localtime data/*.json');
}

// https://github.com/enquirer/enquirer/issues/372
import { prompt, handleSIGINT } from '../src/util.js';

// const handleSIGINT = () => process.on('SIGINT', () => { // e.g. when killed by Ctrl-C
//   console.log('\nInterrupted by SIGINT. Exit!');
//   process.exitCode = 130;
// });
handleSIGINT();

function onRawSIGINT(fn) {
  const { stdin, stdout } = process;
  stdin.setRawMode(true);
  stdin.resume();
  stdin.on('data', data => {
    const key = data.toString('utf-8');
    if (key === '\u0003') { // ctrl + c
      fn();
    } else {
      stdout.write(key);
    }
  });
}
// onRawSIGINT(() => {
//   console.log('raw'); process.exit(1);
// });

console.log('hello');
console.error('hello error');
try {
  let i = 'foo';
  i = await prompt(); // SIGINT no longer handled if this is executed
  i = await prompt(); // SIGINT no longer handled if this is executed
  // handleSIGINT();
  console.log('value:', i);
  setTimeout(() => console.log('timeout 3s'), 3000);
} catch (e) {
  process.exitCode ||= 1;
  console.log('catch. exitCode:', process.exitCode);
  console.error(e);
}
console.log('end. exitCode:', process.exitCode);

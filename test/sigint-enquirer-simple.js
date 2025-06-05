// https://github.com/enquirer/enquirer/issues/372
import Enquirer from 'enquirer';
const enquirer = new Enquirer();

let interrupted = false;
process.on('SIGINT', () => {
  if (interrupted) process.exit();
  interrupted = true;
  console.log('SIGINT');
});
await enquirer.prompt({
  type: 'input',
  name: 'username',
  message: 'What is your username?',
});
await enquirer.prompt({
  type: 'input',
  name: 'username',
  message: 'What is your username 2?',
});

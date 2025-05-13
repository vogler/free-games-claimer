// open issue: prevents handleSIGINT() to work if prompt is cancelled with Ctrl-C instead of Escape: https://github.com/enquirer/enquirer/issues/372
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
console.log(1)
onRawSIGINT(() => {
  console.log('raw'); process.exit(1);
});
console.log(2)

// onRawSIGINT workaround for enquirer keeps the process from exiting here...

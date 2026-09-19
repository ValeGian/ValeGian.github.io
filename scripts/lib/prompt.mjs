/** Reads a password without echoing it, so it never reaches the terminal scrollback. */
export function askHidden(question) {
  return new Promise((resolve, reject) => {
    const { stdin, stdout } = process;
    if (!stdin.isTTY) {
      reject(new Error(`${question} — no terminal available; set the environment variable instead`));
      return;
    }

    stdout.write(question);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    let value = '';
    const onData = (chunk) => {
      for (const character of chunk) {
        if (character === '\n' || character === '\r' || character === '\u0004') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.removeListener('data', onData);
          stdout.write('\n');
          resolve(value);
          return;
        }
        if (character === '\u0003') {
          stdin.setRawMode(false);
          stdout.write('\n');
          reject(new Error('cancelled'));
          return;
        }
        if (character === '\u007f') value = value.slice(0, -1);
        else value += character;
      }
    };

    stdin.on('data', onData);
  });
}

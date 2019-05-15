import {expect} from 'chai';

import * as yaml from '../yaml';
import {render} from '../render';

describe('render', () => {
  const filename = 'test.yaml';
  const argv = {
    template: filename,
    outfile: '/dev/null',
    overwrite: false,
    environment: 'test',
    format: 'yaml',
    // GlobalArguments
    _: [''],
    '$0': ''
  };

  it('can handle single documents', async () => {
    const documents = [
      yaml.loadString('$defs:\n  foo: baz\nfoo: !$ foo', filename)
    ];
    expect(await render(filename, documents, argv)).to.deep.equal(['foo: baz\n']);
  });

  it('can handle multiple documents', async () => {
    const documents = [
      yaml.loadString('$defs:\n  foo: bar\nfoo: !$ foo', filename),
      yaml.loadString('$defs:\n  foo: baz\nfoo: !$ foo', filename)
    ];
    expect(await render(filename, documents, argv)).to.deep.equal(['---', 'foo: bar\n', '---', 'foo: baz\n']);
  });

});

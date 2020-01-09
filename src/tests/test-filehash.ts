import {expect} from 'chai';
import filehash from '../filehash';

describe('filehash', () => {
  it('can handle single files', () => {
    expect(filehash('src/tests/fixtures/filehash/abc.txt'))
      .to.equal('edeaaff3f1774ad2888673770c6d64097e391bc362d7d6fb34982ddf0efd18cb');
  });

  it('throws on missing files', () => {
    expect(() => filehash('i-dont-exists')).to.throw();
  });

  it('can handle directories', () => {
    expect(filehash('src/tests/fixtures/filehash'))
      .to.equal('f62b69785edca0969d53fe3b9f83ce20699524920bff380f8d71be0fc724a52d');
  });

  it('can return base64 format', () => {
    expect(filehash('src/tests/fixtures/filehash', 'base64'))
      .to.equal('9itpeF7coJadU/47n4POIGmVJJIL/zgPjXG+D8ckpS0=');
  });

});

import {expect} from 'chai';
import {parseImportType, filehashLoader} from '../preprocess';

describe('$imports', () => {
  describe('parseImportType', () => {

    it('implicit/file', () => {
      expect(parseImportType('', '')).to.equal('file');
      expect(parseImportType('./foo.txt', '.')).to.equal('file');
      expect(parseImportType('./foo.txt', './base.yaml')).to.equal('file');
      expect(parseImportType('./foo.yaml', './base.yaml')).to.equal('file');
    });


    it('explicit/file', () => {
      expect(parseImportType('file:', '')).to.equal('file'); // TODO should this error?
      expect(parseImportType('file:./foo.txt', '.')).to.equal('file');
      expect(parseImportType('file:./foo.txt', './base.yaml')).to.equal('file');
      expect(parseImportType('file:./foo.yaml', 'file:./base.yaml')).to.equal('file');
      expect(() => parseImportType('file:./foo.yaml', 's3:/bucket/foo.yaml')).to.throw('not allowed');
      expect(() => parseImportType('file:./foo.yaml', 'http:/bucket/foo.yaml')).to.throw('not allowed');
      expect(() => parseImportType('file:./foo.yaml', 'https:/bucket/foo.yaml')).to.throw('not allowed');

    });

    it('implicit relative / s3 or http', () => {
      expect(parseImportType('', 'http://blah.com/')).to.equal('http');
      expect(parseImportType('test.yaml', 'http://blah.com/')).to.equal('http');
      expect(parseImportType('test.jsom', 'http://blah.com/')).to.equal('http');
      expect(parseImportType('test.jsom', 'https://blah.com/')).to.equal('http');
      expect(parseImportType('', 's3://bucket/key')).to.equal('s3');
      expect(parseImportType('test.yaml', 's3://bucket/key')).to.equal('s3');
      expect(parseImportType('test.jsom', 's3://bucket/key')).to.equal('s3');
    });


    it('cfn', () => {
      expect(parseImportType('cfn:exports', 'http://blah.com/')).to.equal('cfn');
    });

    it('git', () => {
      expect(parseImportType('git:describe', './foo.yaml')).to.equal('git');
      expect(parseImportType('git:branch', './foo.yaml')).to.equal('git');
      expect(parseImportType('git:sha', './foo.yaml')).to.equal('git');
    });

    it('unknown', () => {
      expect(() => parseImportType('cfnX:exports', 'http://blah.com/')).to.throw('Unknown import type');
    });

  });

  describe('filehash loader', () => {
    // TODO hashing of remote files from s3 or from http

    it('file exists', async () => {
      const res1 = await filehashLoader('filehash:src/tests/fixtures/filehash/abc.txt', '.');
      expect(res1).to.deep.include({
        data: 'edeaaff3f1774ad2888673770c6d64097e391bc362d7d6fb34982ddf0efd18cb',
        doc: 'edeaaff3f1774ad2888673770c6d64097e391bc362d7d6fb34982ddf0efd18cb'
      });

      const res2 = await filehashLoader('filehash:src/tests/fixtures/filehash/sub', '.');
      expect(res2).to.include({
        data: '58ee32a8a79fa69f9a1ee491b7faed0c6ee8d5467a762ba6404720e4285ccf86',
        doc: '58ee32a8a79fa69f9a1ee491b7faed0c6ee8d5467a762ba6404720e4285ccf86'
      });

    });

    it('file missing with ? prefix', async () => {
      const res1 = await filehashLoader('filehash:?src/tests/fixtures/filehash/missing', '.');
      expect(res1).to.include({
        data: 'FILE_MISSING',
        doc: 'FILE_MISSING'
      });

    });

    it('file missing without ? prefix', async () => {
      const res = await filehashLoader('filehash:./missing', '.').catch(e => e);
      expect(res).to.be.instanceof(Error);
      expect(res.message).to.include('Invalid location')
    });

  });

});

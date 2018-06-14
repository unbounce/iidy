require('./support'); // for side-effect
import {expect} from 'chai';
import * as _ from 'lodash';
import * as jsyaml from 'js-yaml';

import * as pre from '../preprocess';
import * as yaml from '../yaml';

// TODO test various bad paths & error handling

import {
  transform,
  transformNoImport,
  mkMockImportLoader,
  $let
} from './support';

const waitConditionTemplate = {
  Resources: {
    blah:
      {
        Type: 'AWS::CloudFormation::WaitConditionHandle',
        Properties: {}
      }
  }
};

const mkTestEnv = ($envValues: pre.$EnvValues, GlobalAccumulator = {}) => ({
  GlobalAccumulator,
  $envValues,
  Stack: []
})

function assertNo$GutsLeakage(output: pre.CfnDoc) {
  expect(output).not.to.have.property('$defs');
  expect(output).not.to.have.property('$imports');
  expect(output).not.to.have.property('$params');
  expect(output).not.to.have.property('$envValues');
}


describe('Yaml pre-processing', () => {

  //////////////////////////////////////////////////////////////////////
  describe('basics', () => {

    it('leaves input documents unchanged', async () => {
      for (const input of [
        {},
        {foo: 123},
        waitConditionTemplate
      ]) {
        const inputClone = _.clone(input);
        await transform(input);
        // and again with the non-async post import form
        transformNoImport(input);
        expect(input).to.deep.equal(inputClone);
      }

    });

    it('is a no-op for empty documents', async () => {
      const input = {};
      expect(await transform(input)).to.deep.equal(input);
      expect(transformNoImport(input)).to.deep.equal(input);
    });

    it('autodetects Cloudformation yaml templates', async () => {
      for (const input of [
        {Resources: {}},
        {Resources: {}, $defs: {a: 'b'}},
        waitConditionTemplate,
        {AWSTemplateFormatVersion: '2010-09-09'}
      ]) {
        const output = await transform(input);
        expect(output).to.deep.include(_.omit(input, ['$defs']));
        expect(output).to.have.property('AWSTemplateFormatVersion');
        expect(output).to.have.property('Metadata');
        assertNo$GutsLeakage(output);
      }
    });

  });

  //////////////////////////////////////////////////////////////////////
  describe('$imports:', () => {

    it('importLoader mocking works', async () => {
      const testDoc = {
        $imports: {a: 's3://mock/mock1'},
        literal: 1234,
        aref: new yaml.$include('a')
      };
      const expected = {aref: 'mock', literal: 1234};
      const mockLoader = mkMockImportLoader(
        {
          's3://mock/mock1': {data: 'mock'},
          's3://mock/mock2': {data: '', doc: testDoc}
        });
      expect(await transform(testDoc, mockLoader))
        .to.deep.equal(expected);

      expect(await transform({
        $imports: {nested: 's3://mock/mock2'},
        literal: new yaml.$include('nested.literal')
      },
        mockLoader))
        .to.deep.equal({literal: 1234});

      expect(await transform(
        `
$imports: {nested: 's3://mock/mock2'}
aref: !$ nested.aref`, mockLoader)).to.deep.equal({aref: 'mock'});

    });

    describe('import type parsing', () => {
      it('from local baseLocation', () => {
        for (const baseLocation of ['/', '/home/test', '.']) {
          expect(pre.parseImportType('test.yaml', baseLocation)).to.equal('file');
          expect(pre.parseImportType('/root/test.yaml', baseLocation)).to.equal('file');
          expect(pre.parseImportType('sub/test.yaml', baseLocation)).to.equal('file');
          expect(pre.parseImportType('sub/test.json', baseLocation)).to.equal('file');

          expect(pre.parseImportType('s3://bucket/test.yaml', baseLocation)).to.equal('s3');

          expect(pre.parseImportType('http://host.com/test.yaml', baseLocation)).to.equal('http');
          expect(pre.parseImportType('https://host.com/test.yaml', baseLocation)).to.equal('http');


          expect(pre.parseImportType('ssm:/foo', baseLocation)).to.equal('ssm');
          expect(pre.parseImportType('ssm:foo', baseLocation)).to.equal('ssm');
          expect(pre.parseImportType('ssm:/foo/bar', baseLocation)).to.equal('ssm');

          expect(pre.parseImportType('ssm-path:/foo', baseLocation)).to.equal('ssm-path');
          expect(pre.parseImportType('ssm-path:/', baseLocation)).to.equal('ssm-path');
          // TODO validate that ssm-path begins with a /

          expect(pre.parseImportType('random:dashed-name', baseLocation)).to.equal('random');
          expect(pre.parseImportType('random:name', baseLocation)).to.equal('random');
          expect(pre.parseImportType('random:int', baseLocation)).to.equal('random');

          expect(pre.parseImportType('filehash:foo.yaml', baseLocation)).to.equal('filehash');

          // TODO fail upon accidentally leaving the
          // expect(pre.parseImportType('filehash', baseLocation)).to.equal('random');

        }


      });

    });

  });

  //////////////////////////////////////////////////////////////////////
  describe('$defs:', () => {

    it('basic usage with !$ works', async () => {

      expect(await transform({$defs: {a: 'b'}, out: '{{a}}'}))
        .to.deep.equal({out: 'b'});

      expect(await transform({$defs: {a: 'b'}, out: new yaml.$include('a')}))
        .to.deep.equal({out: 'b'});

      expect(await transform({$defs: {a: {b: 'c'}}, out: '{{a.b}}'}))
        .to.deep.equal({out: 'c'});

      expect(await transform({
        $defs: {a: new yaml.$include('b'), b: 'xref'},
        out: new yaml.$include('a')
      }))
        .to.deep.equal({out: 'xref'});
    });
  });

  //////////////////////////////////////////////////////////////////////
  describe('{{handlebars}} syntax', () => {

    it('single variables in strings', async () => {

      expect(await transform({$defs: {a: 'b'}, out: '{{a}}'}))
        .to.deep.equal({out: 'b'});

      expect(await transform({$defs: {a: 'b'}, out: '{{  a  }}'}))
        .to.deep.equal({out: 'b'});

      expect(await transform({$defs: {a: {b: 'c'}}, out: '{{a.b}}'}))
        .to.deep.equal({out: 'c'});

      expect(await transform({$defs: {a: {b: 'c'}}, out: '---{{a.b}}---'}))
        .to.deep.equal({out: '---c---'});

    });


    it('multiple variables in strings', async () => {

      expect(await transform({$defs: {a: 'b', c: 9}, out: '{{a}}{{c}}'}))
        .to.deep.equal({out: 'b9'});

      expect(await transform({$defs: {a: {b: 'c'}, c: 9}, out: '{{a.b}}{{c}}'}))
        .to.deep.equal({out: 'c9'});

      expect(await transform({$defs: {a: {b: 'c'}, c: 9}, out: '---{{a.b}}{{c}}---'}))
        .to.deep.equal({out: '---c9---'});

    });


    it('used in map keys', async () => {

      expect(await transform({$defs: {a: 'b'}, out: {'{{a}}': 1}}))
        .to.deep.equal({out: {b: 1}});

      expect(await transform({$defs: {a: {b: 'c'}}, out: {'{{a.b}}': 1}}))
        .to.deep.equal({out: {'c': 1}});

      expect(await transform({$defs: {a: {b: 'c'}}, out: {'---{{a.b}}---': 1}}))
        .to.deep.equal({out: {'---c---': 1}});

    });


    describe('helper functions', () => {

      it('tojson', async () => {
        expect(await transform({$defs: {a: {b: 9}}, out: '{{tojson a}}'}))
          .to.deep.equal({out: '{"b":9}'});
      });

      it('toyaml', async () => {
        expect(await transform({$defs: {a: {b: 9}}, out: '{{toyaml a}}'}))
          .to.deep.equal({out: 'b: 9\n'});
      });

      it('toLowerCase', async () => {
        expect(await transform({$defs: {a: "ABC"}, out: '{{toLowerCase a}}'}))
          .to.deep.equal({out: 'abc'});
      });

      it('toUpperCase', async () => {
        expect(await transform({$defs: {a: "abc"}, out: '{{toUpperCase a}}'}))
          .to.deep.equal({out: 'ABC'});
      });

      it('base64', async () => {
        expect(await transform({$defs: {a: "abc"}, out: '{{base64 a}}'}))
          .to.deep.equal({out: 'YWJj'});
        const longerString = "abc ".repeat(20);
        expect(await transform({$defs: {a: longerString}, out: '{{base64 a}}'}))
          .to.deep.equal({out: Buffer.from(longerString).toString('base64')});
      });

    });


  });

  //////////////////////////////////////////////////////////////////////
  describe('Custom Resource Templates', () => {
    const testEnvInsideCustomResource = mkTestEnv({
      Prefix: 'Test',
      $globalRefs: {'Bar': true}
    });

    const testEnvOutsideCustomResource = mkTestEnv({});

    it('!Sub ${} reference rewriting', async () => {
      for (const {input, output} of [
        {input: 'Foo', output: 'Foo'},
        {input: 'Bar', output: 'Bar'},
        {input: '${AWS::Region}', output: '${AWS::Region}'},
        {input: '--${AWS::Region }--', output: '--${AWS::Region }--'},

        {input: '${Foo}', output: '${TestFoo}'},
        {input: '${ Foo }', output: '${TestFoo}'},
        {input: '${ Foo.Arn }', output: '${TestFoo.Arn}'},

        {input: 'before ${Foo} after', output: 'before ${TestFoo} after'},

        {input: '${Bar}', output: '${Bar}'},
        {input: 'before ${Bar} after', output: 'before ${Bar} after'},
        {input: '${ Bar }', output: '${ Bar }'},
        {input: '${ Bar.Arn }', output: '${ Bar.Arn }'},

        {input: '${!Foo}', output: '${!Foo}'},

        {
          input: 'arn:aws:logs:${AWS::Region}:${AWS::AccountId}:log-group:/aws/lambda/${Foo}:*',
          output: 'arn:aws:logs:${AWS::Region}:${AWS::AccountId}:log-group:/aws/lambda/${TestFoo}:*'
        }

      ]) {

        expect(
          pre.visitSubStringTemplate(input, 'test', testEnvInsideCustomResource))
          .to.equal(output);

        expect(
          pre.visitSubStringTemplate(input, 'test', testEnvOutsideCustomResource))
          .to.equal(input);

      }

    });

    it('!Ref & !GetAtt reference rewriting', async () => {
      for (const {input, output} of [
        {input: 'Foo', output: 'TestFoo'},
        {input: ' Foo ', output: 'TestFoo'},
        {input: 'Foo.Arn', output: 'TestFoo.Arn'},
        {input: 'Foo.Arn.Blah  ', output: 'TestFoo.Arn.Blah'},

        {input: 'Bar', output: 'Bar'},
        {input: 'Bar.Arn', output: 'Bar.Arn'},
        {input: 'Bar.Blah.Arn', output: 'Bar.Blah.Arn'},
        {input: ' Bar.Arn ', output: ' Bar.Arn '},

      ]) {
        expect(
          pre.visitRef(
            new yaml.Ref(input), 'test', testEnvInsideCustomResource))
          .to.deep.equal(new yaml.Ref(output));

        expect(
          pre.visitGetAtt(
            new yaml.GetAtt(input), 'test', testEnvInsideCustomResource))
          .to.deep.equal(new yaml.GetAtt(output));

        // no rewrite
        expect(
          pre.visitRef(
            new yaml.Ref(input), 'test', testEnvOutsideCustomResource))
          .to.deep.equal(new yaml.Ref(input));

        expect(
          pre.visitGetAtt(
            new yaml.GetAtt(input), 'test', testEnvOutsideCustomResource))
          .to.deep.equal(new yaml.GetAtt(input));
      }

    });

    it('Templates with no parameters', async () => {

    });

    it.skip('Templates with $params', async () => {

    });

    it.skip('$params validation', async () => {

    });

    it.skip('$params with defaults', async () => {

    });

    it.skip('Templates with $imports', async () => {

    });

    it.skip('Nested templates invocation', async () => {

    });

  });

  //////////////////////////////////////////////////////////////////////
  describe('Custom YAML tags', () => {

    //////////////////////////////
    describe('!$let', () => {
      it('basic usage of !$let & !$ works', async () => {
        expect(await transform({out: $let({a: 'b', in: '{{a}}'})}))
          .to.deep.equal({out: 'b'});

        expect(await transform({out: $let({a: 'b', in: new yaml.$include('a')})}))
          .to.deep.equal({out: 'b'});

        expect(await transform({out: $let({a: {b: 'c'}, in: {inner: '{{a.b}}'}})}))
          .to.deep.equal({out: {inner: 'c'}});
      });


      it.skip('xrefs', async () => {
        expect(await transform(
          {
            out: $let({
              a: new yaml.$include('b'),
              b: 'xref',
              in: {inner: new yaml.$include('a')}
            })
          }))
          .to.deep.equal({out: {inner: 'xref'}});
      });

    });


    //////////////////////////////
    describe('Boolean / Logical Branching Tags', () => {

      it('!$eq', async () => {
        expect(await transform(`out: !$eq [1,1]`))
          .to.deep.equal(jsyaml.load(`out: true`));

        expect(await transform(`out: !$eq [true,true]`))
          .to.deep.equal(jsyaml.load(`out: true`));

        expect(await transform(`out: !$eq [false,true]`))
          .to.deep.equal(jsyaml.load(`out: false`));
      });

      it('!$not', async () => {

        expect(await transform(`out: !$not true`))
          .to.deep.equal(jsyaml.load(`out: false`));

        // expect(await transform(`out: !$not false`))
        //   .to.deep.equal(jsyaml.load(`out: true`));

      });

    });


    //////////////////////////////
    describe('Looping and Data Restructuring Tags', () => {

      describe('!$concat', () => {
        // TODO rename to !$concat
        it('basic forms', async () => {
          expect(await transform(`
$defs:
  a: [7,8,9]
out: !$concat
  - [1,2,3]
  - [4,5,6]
  - !$ a
`
          )).to.deep.equal(jsyaml.load(`out: [1,2,3,4,5,6,7,8,9]`));
        });
      });

      describe('!$map', () => {
        const simpleMapRendered = {m: [{v: 1}, {v: 2}, {v: 3}]};
        it('basic forms', async () => {
          expect(await transform(`
m: !$map
  items: [1,2,3]
  template: !$ item
`)).to.deep.equal({m: [1, 2, 3]});

          expect(await transform(`
m: !$map
  items: [1,2,3]
  template:
    v: !$ item
`)).to.deep.equal(simpleMapRendered);

          expect(await transform(`
m: !$map
  items:
    - v: 1
    - v: 2
    - v: 3
  template:
    v: !$ item.v
`)).to.deep.equal(simpleMapRendered);

          expect(await transform(`
m: !$map
  items:
    - v: {sub: 1}
    - v: {sub: 2}
    - v: {sub: 3}
  template:
    v: !$ item.v.sub
`)).to.deep.equal(simpleMapRendered);

          expect(await transform(`
ports: !$map
  template:
    CidrIp: "0.0.0.0/0"
    FromPort: !$ item
    ToPort: !$ item
  items: [80, 443]`
          )).to.deep.equal(jsyaml.load(`
ports:
  - CidrIp: 0.0.0.0/0
    FromPort: 80
    ToPort: 80
  - CidrIp: 0.0.0.0/0
    FromPort: 443
    ToPort: 443`));

        });

        it('var', async () => {
          expect(await transform(`
m: !$map
  var: i
  items:
    - v: {sub: 1}
    - v: {sub: 2}
    - v: {sub: 3}
  template:
    v: !$ i.v.sub
`)).to.deep.equal(simpleMapRendered);

        });
      });

      describe('!$concatMap', () => {

        it('basic forms', async () => {

          expect(await transform(`
nested: !$concatMap
  items: [80, 443]
  var: port
  template: !$map
    var: cidr
    items: ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"]
    template:
      CidrIp:   !$ cidr
      FromPort: !$ port
      ToPort:   !$ port
`
          )).to.deep.equal(jsyaml.load(`
nested:
  - CidrIp: 10.0.0.0/8
    FromPort: 80
    ToPort: 80
  - CidrIp: 172.16.0.0/12
    FromPort: 80
    ToPort: 80
  - CidrIp: 192.168.0.0/16
    FromPort: 80
    ToPort: 80
  - CidrIp: 10.0.0.0/8
    FromPort: 443
    ToPort: 443
  - CidrIp: 172.16.0.0/12
    FromPort: 443
    ToPort: 443
  - CidrIp: 192.168.0.0/16
    FromPort: 443
    ToPort: 443`));


        });

      });

      describe('!$merge', () => {
        const map1 = {a: 1, b: 2};
        const map2 = {a: 91, c: 3};
        const map3 = {c: 4, d: 99};
        const result = _.merge({}, map1, map2, map3);

        it('with a list of maps', async () => {
          expect(await transform(`
m: !$merge
    - ${JSON.stringify(map1)}
    - ${JSON.stringify(map2)}
    - ${JSON.stringify(map3)}
`)).to.deep.equal({m: result});
        });

        it('with a string argument referring to a variable', async () => {
          expect(await transform(`
$defs:
  maps:
    - ${JSON.stringify(map1)}
    - ${JSON.stringify(map2)}
    - ${JSON.stringify(map3)}
output: !$merge maps
`)).to.deep.equal({output: result});
        });

      });

      describe('!$mergeMap', () => {
        it('with three maps in a list', async () => {
          const map1 = {a: 1, b: 2};
          const map2 = {a: 91, c: 3};
          const map3 = {c: 4, d: 99};
          const result = _.merge({}, map1, map2, map3);
          expect(await transform(`
m: !$mergeMap
  template: !$ item.v
  items:
    - v: ${JSON.stringify(map1)}
    - v: ${JSON.stringify(map2)}
    - v: ${JSON.stringify(map3)}
`)).to.deep.equal({m: result});

        });
      });

      describe('!$fromPairs', () => {

        it('basic forms', async () => {
          expect(await transform(`
out: !$fromPairs
  - key: a
    value: 1
  - key: b
    value: 2
  - key: c
    value: 3
`
          )).to.deep.equal(jsyaml.load(`
out:
  a: 1
  b: 2
  c: 3`));
        });
      });

      describe('!$mapListToHash', () => {

        it('basic forms', async () => {
          expect(await transform(`
out: !$mapListToHash
  template:
    key: !$ item.0
    value: !$ item.1
  items:
    - ['a', "v1"]
    - ['b', "v2"]`
          )).to.deep.equal(jsyaml.load(`
out:
  a: v1
  b: v2`));

        });

        it('var', async () => {
          expect(await transform(`
out: !$mapListToHash
  var: i
  template:
    key: !$ i.0
    value: !$ i.1
  items:
    - ['a', "v1"]
    - ['b', "v2"]`
          )).to.deep.equal(jsyaml.load(`
out:
  a: v1
  b: v2`));

        });
      });

      describe('!$split', () => {
        it('basic forms', async () => {
          expect(await transform(`
m: !$split [',', 'a,b,c']
`)).to.deep.equal({m: ['a', 'b', 'c']});
        });

        it('newlines', async () => {
          expect(await transform(`
m: !$split
  - "\\n"
  - |-
   a
   b
   c
`)).to.deep.equal({m: ['a', 'b', 'c']});
        });
      });


    });
    // END 'Looping and Data Restructuring Tags'
    //////////////////////////////


  });

  //////////////////////////////////////////////////////////////////////
  // syntax elements that are not custom tags
  // (excluding $imports and $defs which are covered above)
  describe('Special YAML keys (prefixed with $)', () => {

    describe('$merge', () => {

      it('simple $merge', async () => {
        expect(await transform(`
a: 1
b: 2
$merge:
  c: 22
  d: 33
`)).to.deep.equal({a: 1, b: 2, c: 22, d: 33});
      });

      it('multiple $merge\'s in one document', async () => {
        expect(await transform(`
a: 1
b: 2
$merge1:
  c: 22
  d: 33

$merge2:
  f: 10
  g: 11

$merge3:
  h: 20
  i: 21
`)).to.deep.equal({a: 1, b: 2, c: 22, d: 33, f: 10, g: 11, h: 20, i: 21});
      });

      it('deep $merge', async () => {
        expect(await transform(`
a:
  a: 1
  b: 2
c: 99
$merge:
  a:
    b: 22
    c: 33
`)).to.deep.equal({a: {a: 1, b: 22, c: 33}, c: 99});
      });

      it('nested $merge', async () => {
        expect(await transform(`
a:
  a: 1
  b: 2
c: 99
$merge:
  a:
    b: 22
    c: 33
  $merge:
    a: 101
    d: 201
`)).to.deep.equal({a: 101, c: 99, d: 201});
      });


    });
  });

});

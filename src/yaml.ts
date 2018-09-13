//tslint:disable no-any
import * as _ from 'lodash';
import * as jsyaml from 'js-yaml';

type YamlKind = 'scalar' | 'mapping' | 'sequence';

export class Tag<T = any> {
  ctor: any // see below re fugly
  constructor(private _data: any) {
    this.ctor = new.target;
  }

  update(data: T): this {
    // fugly but can't call new.target from here. This is equivalent
    // to this.constructor in plain js.
    return new this.ctor(data);
  }

  get data(): T {
    // post-parsing / validation we can narrow the type to T
    return this._data
  }
}

function mkTagClass(tag_name: string) {
  return class AnonTag extends Tag {
    tag_name = tag_name;
  }
}

const schemaTypes: jsyaml.Type[] = [];
export const customTags: {[key: string]: typeof Tag} = {};

type Resolver = any;

function addCFNTagType(tag_name: string, kind: YamlKind, resolve?: Resolver) {
  const kls = _.has(customTags, tag_name) ? customTags[tag_name] : mkTagClass(tag_name);
  customTags[tag_name] = kls;
  schemaTypes.push(new jsyaml.Type('!' + tag_name, {
    kind: kind,
    instanceOf: kls,
    resolve: resolve,
    construct: (data: any) => new kls(data),
    represent: (node: any) => node.data
  }));
}

// http://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/intrinsic-function-reference.html
addCFNTagType('Base64', 'scalar');
addCFNTagType('Base64', 'mapping');


// [ MapName, TopLevelKey, SecondLevelKey ]
export class FindInMap extends Tag<string[]> {}
customTags.FindInMap = FindInMap;
addCFNTagType('FindInMap', 'sequence');

export class GetAtt extends Tag<string | string[]> {}
customTags.GetAtt = GetAtt;
addCFNTagType('GetAtt', 'scalar');
addCFNTagType('GetAtt', 'sequence');

addCFNTagType('GetAZs', 'scalar');
addCFNTagType('GetAZs', 'mapping');
addCFNTagType('GetAZs', 'sequence');


// ImportValue will be either a literal string or a !Sub string
export class ImportValue extends Tag<string | object> {}
customTags.ImportValue = ImportValue;
addCFNTagType('ImportValue', 'scalar');
addCFNTagType('ImportValue', 'mapping');

addCFNTagType('Join', 'sequence');
addCFNTagType('Split', 'sequence');

export class Ref extends Tag<string> {}
customTags.Ref = Ref;
addCFNTagType('Ref', 'scalar');
addCFNTagType('Ref', 'sequence');

addCFNTagType('Select', 'sequence');

export class Sub extends Tag<string | [string, object] | [string]> {}
customTags.Sub = Sub;
addCFNTagType('Sub', 'scalar');
addCFNTagType('Sub', 'sequence');
addCFNTagType('Sub', 'mapping');


// http://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/continuous-delivery-codepipeline-action-reference.html
addCFNTagType('GetParam', 'sequence');

// http://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/intrinsic-function-reference-conditions.html
addCFNTagType('And', 'sequence');
addCFNTagType('Equals', 'sequence');
addCFNTagType('If', 'sequence');
addCFNTagType('Not', 'sequence');
addCFNTagType('Or', 'sequence');


////////////////////////////////////////////////////////////////////////////////
// custom !$tag support

function addCustomTag(name: string | string[], kls: any, resolve?: Resolver) {
  const names = _.isArray(name) ? name : [name];
  for (const nm of names) {
    customTags[nm] = kls
    // add all even if primitive types even if only a subset is valid as
    // the error reporting is better handled elsewhere.
    addCFNTagType(nm, 'scalar', resolve);
    addCFNTagType(nm, 'sequence', resolve);
    addCFNTagType(nm, 'mapping', resolve);
  }
}

////////////////////////////////////////////////////////////////////////////////
// basic interpolation related custom tags

export class $include extends Tag<string> {}
addCustomTag(['$include', '$'], $include); // scalar

export class $escape extends Tag {}
addCustomTag('$escape', $escape); // any

export class $string extends Tag {}
addCustomTag('$string', $string); // any

export class $parseYaml extends Tag<string> {}
addCustomTag('$parseYaml', $parseYaml); // scalar string

////////////////////////////////////////////////////////////////////////////////
// variable definition and template expansion custom tags

export type $LetParams = {in: any, [key: string]: any};
export class $let extends Tag<$LetParams> {}
addCustomTag('$let', $let); // mapping

export class $expand extends Tag {} // TODO narrow type
addCustomTag('$expand', $expand); // mapping

////////////////////////////////////////////////////////////////////////////////
// boolean / logical branching custom tags

export type $IfParams = {test: any, then: any, else: any};
export class $if extends Tag<$IfParams> {}
addCustomTag('$if', $if); // mapping

export class $not extends Tag<any> {}
addCustomTag('$not', $not); // mapping

export class $eq extends Tag<[any, any]> {}
addCustomTag('$eq', $eq); // mapping

////////////////////////////////////////////////////////////////////////////////
// looping and data restructuring custom tags

export class $concat extends Tag<any[][]> {}
addCustomTag('$concat', $concat); // sequence

export class $merge extends Tag<object[]> {}
addCustomTag('$merge', $merge); // sequence

export class $fromPairs extends Tag<{key: string, value: any}[]> {}
addCustomTag('$fromPairs', $fromPairs); // mapping

export type $MapParams = {template: any, items: any[], var?: string, filter?: any};
export class $map extends Tag<$MapParams> {}
addCustomTag('$map', $map); // mapping

export class $concatMap extends Tag<$MapParams> {}
addCustomTag('$concatMap', $concatMap); // mapping

export class $mergeMap extends Tag<$MapParams> {}
addCustomTag('$mergeMap', $mergeMap); // mapping

export class $mapListToHash extends Tag<$MapParams> {}
addCustomTag('$mapListToHash', $mapListToHash); // mapping

export class $mapValues extends Tag<$MapParams> {}
addCustomTag('$mapValues', $mapValues); // mapping

export class $groupBy extends Tag<{items: any, key: any, var?: string, template?: any}> {}
addCustomTag('$groupBy', $groupBy); // mapping

export class $split extends Tag<[string, string]> {}
addCustomTag('$split', $split); // sequence

// TODO enumerate, zip, zipWith

////////////////////////////////////////////////////////////////////////////////
const schema = jsyaml.Schema.create(schemaTypes);

export const loadString = (content: string | Buffer, filename: string): any =>
  jsyaml.safeLoad(content.toString(), {schema: schema, filename: filename});

export const loadStringAll = (content: string | Buffer, filename: string): any =>
  jsyaml.loadAll(content.toString(), undefined, {schema: schema, filename: filename});

export const dump = (doc: object): string =>
  jsyaml.safeDump(doc, {schema: schema, lineWidth: 999})
    .replace(/!<!([^>]+?)>/g, '!$1')
    .replace(/ !\$include /g, ' !$ ')
    .replace(/: \$0string (0\d+)$/gm, ": '$1'")
    .replace(/\$0string (0\d+)/g, "$1");
// $0string ^ is an encoding added in preprocess/index.ts:visitString. The first
// regex handles non-octal strings on their own, which must be quoted. The
// second handles them in the middle of a string, where they must not be quoted.

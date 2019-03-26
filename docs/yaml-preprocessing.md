## YAML Pre-Processing

In additional to wrapping the Cloudformation API / workflow, `iidy`
provides an optional YAML pre-processor, which

* allows CloudFormation templates to be abstracted and simplified in
  ways not possible with vanilla CloudFormation templates
* allows values to be imported from a range of sources, including
  local files, s3, https, ParameterStore, and environment variables.
  It parses json or YAML imports. The imported data can be stitched
  into the target template as YAML subtrees, as literal strings, or as
  single values.
* can be used to define custom resource templates that expand out
  to a set of real AWS resources. These templates can be parameterized
  and can even do input validation on the parameters. The template
  expansion and validation happens as a pre-process step prior to
  invoking CloudFormation on the rendered output.

It can be used on CloudFormation template files, `stack-args.yaml`,
and any other YAML file. The pre-processor is applied automatically to
`stack-args.yaml` and optionally to CloudFormation templates by
prefixing the Template value in `stack-args.yaml` with `render:` as
shown below.

```yaml
StackName: iidy-demo
Template: "render:./cfn-template.yaml"
Parameters:
  Foo: bar
```



The pre-processor can also be invoked directly on any YAML file via the
`iidy render` cli command.

### Basic Syntax

The pre-processor language is valid YAML with some [custom
tags](http://yaml.org/spec/1.0/#id2490971). These tags all start with
the characters `!$`. There are also a few special map keys, starting
with `$`. Both sets of YAML extensions are explained below.

This documentation assumes you already know YAML syntax well. See
https://en.wikipedia.org/wiki/YAML#Syntax or
http://www.yaml.org/spec/1.2/spec.html for help.

### `$imports`, `$defs`, and Includes

Each YAML document is treated as a module with a distinct namespace.
Values in a namespace are defined via the `$defs:` entry at the root
of the document or are imported via the `$imports:` entry.

These values can be accessed and stitched into the output using either
the `!$` (pronounced "include") custom tag or with handlebarsjs syntax
inside a string entry.

```yaml
# input document
$defs:
  hello: "world"

output:
  by-tag: !$ hello
  by-handlebars: "{{hello}}"

---
# output document
output:
  by-tag: "world"
  by-handlebars: "world"

```

Note that the braces used with the handlebars syntax must be enclosed
in a quoted string or the YAML parser will treat them as a YAML map node.

If the value being included is a map or list rather than a simple
scalar value, it is spliced into the output rather than being
collapsed in any way.

```yaml
# input document
$defs:
  a-list:
    - 1
    - 2
  a-map:
    k1: v1
    k2: v2
  a-string: "foo"
  a-number: 1
  a-bool: false

output:
  a-list: !$ a-list
  a-map: !$ a-map
  a-string: !$ a-string
  a-number: !$ a-number
  a-bool: !$ a-bool

---
# output document
output:
  a-list:
    - 1
    - 2
  a-map:
    k1: v1
    k2: v2
  a-string: "foo"
  a-number: 1
  a-bool: false

```

The entries in `$defs:` may use values from `$imports:` and an import
source may contain handlebars syntax which refers to either values
that have come from `$defs` or from previous `$imports`.

For example, `values` in this set of imports depends on `other`:
```yaml
$imports:
  other: "env:other:default"
  values: "{{other}}.yaml"
```

This example is simillar to the previous but `other` is defined as a fixed value.
```yaml
$defs:
  other: blah
$imports:
  values: "{{other}}.yaml"
```

#### Sources for `$imports`

Imports are specified per YAML document under the special
document-level key `$imports`. Its value is map from import names to
import sources.

For example, if we had the following file:
```yaml
# names.yaml
mundi: world
#...
```

We could import it into another file and use the values it contains:
```yaml
# input document
$imports:
  # <an arbitrary import name>: <importSource>
  names: ./names.yaml

output:
  hello: !$ names.mundi
---
# output document
outputs:
  hello: world

```

`iidy` supports a wide range of import sources:

* local file paths (relative or absolute): e.g. `./some-file.yaml`
* filehash: e.g. `filehash:./some-file.yaml`
* https or http: e.g. `https://example.com/some-file.yaml`
* environment variables: e.g. `env:FOO` or with an optional default value `env:FOO:bar`
* s3 (tied to an AWS account / region): e.g.
  `s3://somebucket/some-file.yaml`. Requires `s3:GetObject` IAM
  permissions.
* CloudFormation stacks (tied to an AWS account / region). These
  require requires IAM `cloudformation:ListExports` and
  `cloudformation:DescribeStack` permissions.
  * `cfn:export:someExportName`
  * `cfn:output:stackName:anOutputName` or `cfn:output:stackName` imports all outputs
  * `cfn:resource:stackName:resourceName` or `cfn:resource:stackName` imports all resources
  * `cfn:parameter:stackName:parameterName` or `cfn:parameter:stackName` imports all parameters
  * `cfn:tag:stackName:tagName` or `cfn:tag:stackName` imports all tags
  * `cfn:stack:stackName` imports all stack details from the CloudFormation API
* AWS SSM ParameterStore (tied to an AWS account / region). These
  require IAM `ssm:GetParameters`, `ssm:GetParameter`, and
  `ssm:DescribeParameter` permissions.
  * `ssm:/some-path-prefix/foo`: a single entry
  * `ssm-path:/some-path-prefix/`: all entries under a path prefix
* random
  * `random:int`
  * `random:dashed-name`
  * `random:name`
* git
  * `git:branch`
  * `git:describe`
  * `git:sha`

`iidy` parses `.yaml` or `.json` imports and makes them available as a
map. It uses either the file extension or the mime-type of remote
files to detect these file types.

Relative imports are supported for local files, http, and s3.

### Boolean / Logical Branching Tags

```yaml
# !$if { test: bool, then: ~ , else: ~ }

thing: !$if
  test: true
  then: Do the thing
  else: Don't do the thing

# thing: Do the thing
```

```yaml
# !$eq [a, b]

thing: !$if
  test: !$eq ['thing', 'thing']
  then: They're the same
  else: They're not the same

# thing: They're the same
```

```yaml
# !$not bool

thing: !$if
  test: !$not true
  then: Don't do the thing
  else: Do the thing

# thing: Do the thing
```

### Looping and Data Restructuring Tags

* `!$concat` concatenate lists of lists

```yaml
# !$concat [a, b, ...]

things: !$concat
  - [a, b]
  - [c, d]
  - [e, f]

# things:
#   - a
#   - b
#   - c
#   - d
#   - e
#   - f
```

* `!$merge` merge a list of maps together, similar to lodash [`_.merge`](https://lodash.com/docs/4.17.4#merge)

```yaml
# !$merge [{}, {}, ...]

things: !$merge
  - { a: 1 }
  - { b: 2 }
  - { c: 3 }

# things:
#   a: 1
#   b: 2
#   c: 3
```

* `!$fromPairs` convert a list of pairs into a map

```yaml
# !$fromPairs [{ key: a, value: 1}, { key: b, value: 2}]

things: !$fromPairs
  - { key: a, value: 1 }
  - { key: b, value: 2 }
  - { key: c, value: 3 }

# things:
#   a: 1
#   b: 2
#   c: 3
```

* `!$map` map a YAML template over a list of input arguments

```yaml
# !$map { template: {}, items: [], var: 'item', filter: ~ }

things: !$map
  items:
    - first: Rick
      last: Perreault
    - first: Carl
      last: Schmidt
  template:
    name: '{{ item.first }} {{ item.last }}'

# things:
#   - name: Rick Perreault
#   - name: Carl Schmidt

things: !$map
  var: person
  items:
    - first: Rick
      last: Perreault
    - first: Carl
      last: Schmidt
  template:
    name: '{{ person.first }} {{ person.last }}'

# things:
#   - name: Rick Perreault
#   - name: Carl Schmidt

things: !$map
  filter: !$eq ['Rick', !$ person.first]
  var: person
  items:
    - first: Rick
      last: Perreault
    - first: Carl
      last: Schmidt
  template:
    name: '{{ person.first }} {{ person.last }}'

# things:
#   - name: Rick Perreault
```

* `!$concatMap` same as `!$map` followed by `!$concat` on the output

```yaml
# !$concatMap { template: {}, items: [], var: 'item', filter: ~ }

$defs:
  letters: [A, B, C]
  numbers: [1, 2, 3]

things: !$concatMap
  items: !$ letters
  var: letter
  template: !$map
    items: !$ numbers
    var: number
    template: '{{ letter }}{{ number }}'

# things:
#   - A1
#   - A2
#   - A3
#   - B1
#   - B2
#   - B3
#   - C1
#   - C2
#   - C3
```

* `!$mergeMap` same as `!$map` followed by `!$merge` on the output

```yaml
# !$mergeMap { template: {}, items: [], var: 'item', filter: ~ }

things: !$mergeMap
  items:
    - first: Rick
      last: Perreault
    - first: Carl
      last: Schmidt
  template:
    '{{ item.first }}': '{{ item.last }}'

# things:
#   Rick: Perreault
#   Carl: Schmidt
```

```yaml
# !$mapListToHash { template: {}, items: [], var: 'item', filter: ~ }
```

```yaml
# !$mapValues { template: {}, items: [], var: 'item', filter: ~ }
```

* `!$groupBy` similar to lodash [`_.merge`](https://lodash.com/docs/4.17.4#groupBy)

```yaml
# !$groupBy { template: {}, items: [], var: 'item', filter: ~ }

things: !$groupBy
  key: team
  items:
    - name: Rick Perreault
      team: Founder
    - name: Carl Schmidt
      team: Founder
    - name: Emily Mears
      team: DevX
    - name: James Brennan
      team: DevX
  template: !$ item.name

# things:
#  Founder: [Rick Perreault, Carl Schmidt]
#  DevX: [Emily Mears, James Brennan]
```

* `!$split` split a string into a list

```yaml
# !$ split [delimiter, string]

things:
  - ', '
  - Rick Perreault, Carl Schmidt

# things:
#   - Rick Perreault
#   - Carl Schmidt
```


### String manipulation Tags

* `!$parseYaml` parse a string

```
# !$parseYaml string

things: !$parseYaml "[a,b,c]"

# things:
#  - a
#  - b
#  - c
```

* `!$escape` 🤷‍️

```
# !$escape {}

things: !$escape { a: b }

# things:
#   a: b
```

* `!$string` convert to a YAML string

```
# !$string {}

things: !$string
  a: b

# things: "a: b\n"
```

* `!$parseYaml` parse YAML string, opposite of `!$string`

```
# !$parseYaml {}

things: !$parseYaml "a: b\n"

# things:
#   a: b
```

* `!$let` local variable binding

```
# !$let { in: {}, ...bindings }

things: !$let
  first: Rick
  last: Perreault
  in:
    fullName: '{{ first }} {{ last }}'

# things:
#   fullName: Rick Perreault
```

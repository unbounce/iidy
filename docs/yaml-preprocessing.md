# YAML Pre-Processing

In additional to wrapping the Cloudformation API / workflow, iidy
provides an optional YAML pre-processor, which

* allows CloudFormation templates to be abstracted and simplified in
  ways not possible with vanilla CloudFormation templates
* allows values to be imported from a range of sources, including
  local files, s3, https, ParameterStore, and environment variables.
  It parses JSON or YAML imports. The imported data can be stitched
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

## Basic Syntax

The pre-processor language is valid YAML with some [custom
tags](http://yaml.org/spec/1.0/#id2490971). These tags all start with
the characters `!$`. There are also a few special map keys, starting
with `$`. Both sets of YAML extensions are explained below.

This documentation assumes you already know YAML syntax well. See
https://en.wikipedia.org/wiki/YAML#Syntax or
http://www.yaml.org/spec/1.2/spec.html for help.

## `$imports`, `$defs`, and Includes

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
  escaped-handlebars: "\\{{hello}}"

---
# output document
output:
  by-tag: "world"
  by-handlebars: "world"
  escaped-handlebars: "{{hello}}"

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
document-level key `$imports`. Its value is a map of import names to
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

See [Importing Data](../README.md#importing-data) for a complete list of import sources.

### Escaping Handlebars braces

If you're using cloudformation [dynamic
references](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/dynamic-references.html) such as
`{{resolve:secretsmanager:MyRDSSecret:SecretString:username}}` you'll need to escape the double braces with a double
backslash to prevent `iidy` from interpreting them as the start of a handlebars expression.

Handlebars string: `aYamlKey: "{{blah}}"`

Handlebars string: `aYamlKey: "\\{{blah}}"`

See issue [#260](https://github.com/unbounce/iidy/issues/260) for a longer example.

### Handlebars Syntax and Helpers

The [string helpers from
handlebars-helpers](https://github.com/helpers/handlebars-helpers#string) (such
as `titleize`, `trim`, `reverse`, etc) are included for basic string
manipulation in addition to the following helpers.

#### `toJson`

```yaml
$defs:
  a:
    b: 9

out: '{{toJson a}}'
```

```yaml
out: '{"b":9}'
```

`tojson` is an alias of `toJson` and is deprecated.

#### `toJsonPretty`

```yaml
$defs:
  a:
    b:
      c: 9
out: '{{toJsonPretty a}}'
```

```yaml
out: '{\n \"b\": {\n  \"c\": 9\n }\n}'
```

`tojsonPretty` is an alias of `toJsonPretty` and is deprecated.

#### `toYaml`

```yaml
$defs:
  a:
    b: 9

out: '{{toYaml a}}'
```

```yaml
out: 'b: 9\n'
```

`toyaml` is an alias of `toYaml` and is deprecated.

#### `toLowerCase`

```yaml
$defs:
  a: ABC

out: '{{toLowerCase a}}'
```

```yaml
out: 'abc'
```

#### `toUpperCase`

```yaml
$defs:
  a: abc

out: '{{toUpperCase a}}'
```

```yaml
out: 'ABC'
```

#### `base64`

```yaml
$defs:
  a: abc

out: '{{base64 a}}'
```

```yaml
out: 'YWJj'
```

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

people: !$map
  items:
    - first: Linus
      last: Torvalds
    - first: Grace
      last: Hopper
  template:
    name: '{{ item.first }} {{ item.last }}'

# people:
#   - name: Linus Torvalds
#   - name: Grace Hopper

people: !$map
  var: person
  items:
    - first: Linus
      last: Torvalds
    - first: Grace
      last: Hopper
  template:
    name: '{{ person.first }} {{ person.last }}'

# people:
#   - name: Linus Torvalds
#   - name: Grace Hopper

people: !$map
  filter: !$eq ['Linus', !$ person.first]
  var: person
  items:
    - first: Linus
      last: Torvalds
    - first: Grace
      last: Hopper
  template:
    name: '{{ person.first }} {{ person.last }}'

# people:
#   - name: Linus Torvalds
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

people: !$mergeMap
  items:
    - first: Linus
      last: Torvalds
    - first: Grace
      last: Hopper
  template:
    '{{ item.first }}': '{{ item.last }}'

# people:
#   Linus: Torvalds
#   Grace: Hopper
```

```yaml
# !$mapListToHash { template: { key: ~, value: ~ }, items: [], var: 'item', filter: ~ }

things: !$mapListToHash
  items:
    - [a, 1]
    - [b, 2]
  template:
    key: !$ item.0
    value: !$ item.1

# things:
#   a: 1
#   b: 2
```

```yaml
# !$mapValues { template: {}, items: [], var: 'item', filter: ~ }

things: !$mapValues
  items:
    a: 1
    b: 2
  template: !$ item

# things:
#   a:
#     value: 1
#     key: a
#   b:
#     value: 2
#     key: b
```

* `!$groupBy` similar to lodash [`_.merge`](https://lodash.com/docs/4.17.4#groupBy)

```yaml
# !$groupBy { template: {}, items: [], var: 'item', filter: ~ }

people: !$groupBy
  key: !$ item.company
  items:
    - name: Ken Tompson
      company: Bell
    - name: Margaret Hamilton
      company: NASA
    - name: Dennis Ritchie
      company: Bell
  template: !$ item.name

# people:
#   Bell:
#     - Ken Tompson
#     - Dennis Ritchie
#   NASA:
#     - Margaret Hamilton
```

* `!$split` split a string into a list

```yaml
# !$split [delimiter, string]

`!$split` can be used in places where CloudFormation does not allow its own `!Split` function, or when working with non-CloudFormation documents.

things: !$split
  - ', '
  - a, b

# things:
#   - a
#   - b
```

* `!$join` join a list into a string

`!$join` can be used in places where CloudFormation does not allow its own `!Join` function, or when working with non-CloudFormation documents.

```yaml
# !$join [delimiter, strings]

things: !$join
  - ', '
  - - a
    - b

# things: a, b
```

### String manipulation Tags

* `!$parseYaml` parse a string

```yaml
# !$parseYaml string

things: !$parseYaml "[a,b,c]"

# things:
#  - a
#  - b
#  - c
```

* `!$escape` prevent iidy from doing any pre-processing on the child tree

```yaml
# !$escape {}

things: !$escape { a: b }

# things:
#   a: b

things: !$escape '{{ a }}'

# things: '{{ a }}'

things: !$escape
  - !$ a

# things:
#  - !$ a
```

* `!$string` convert data to a YAML string
`!$toYamlString` is an alias of `!$string`

```yaml
# !$string {}

things: !$string
  a: b

# things: |
#   a: b
```

* `!$parseYaml` parse YAML string, opposite of `!$string`

```yaml
# !$parseYaml {}

things: !$parseYaml "a: b\n"

# things:
#   a: b
```

* `!$toJsonString` convert data to a JSON string

```yaml
# !$toJsonString {}

things: !$toJsonString
  a: b

# things: '{"a":"b"}'
```

* `!$parseJson` parse JSON string, opposite of `!$toJsonString`

```json
# !$parseJson {}

things: !$parseJson '{ "a":"b" }'

# things:
#   a: b
```

* `!$let` local variable binding

```yaml
# !$let { in: {}, ...bindings }

people: !$let
  first: Linus
  last: Torvalds
  in:
    fullName: '{{ first }} {{ last }}'

# people:
#   fullName: Linus Torvalds
```

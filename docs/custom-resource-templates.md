# Custom Resource Templates

`iidy` autodetects whether a YAML document is a CloudFormation template or not.
If it is, the [`custom resource templates`](#custom-resource-templates)
(described below) and some validation/normalization features are enabled.

NOTE: this section is work in progress

Before we get into the details here's a simple -- and rather pointless
-- example. We define a custom template `demo-custom-template.yaml`
which has two `$params` and outputs two `Resources`. Then in
`demo-cnf-template.yaml` we import the custom template and use it as
the `Type:` in the `Demo` resource.

```YAML
# demo-custom-template.yaml
$params:
  - Name: Foo
    Type: string
  - Name: Bar
    Type: string
Resources:
  Topic1:
    Type: AWS::SNS::Topic
    Properties:
      DisplayName: "Hello {{Foo}}"
  Topic2:
    Type: AWS::SNS::Topic
    Properties:
      DisplayName: "Hello {{Bar}}"

```

```YAML
# demo-cfn-template.yaml
$imports:
  DemoTmpl: demo-custom-template.yaml
  # ^ the name is arbitrary
Resources:
  Demo:
    Type: DemoTmpl # use it here
    Properties:
      # these are threaded in as the $params defined in demo-custom-template.yaml
      Foo: 123
      Bar: 456
  SomeOtherResource:
    Type: AWS::SNS::Topic
    Properties:
      DisplayName: "non-custom"
```

We can use `iidy render demo-cfn-template.yaml` to see the final
template:

```YAML
AWSTemplateFormatVersion: '2010-09-09'
Resources:
  DemoTopic1:
    Type: 'AWS::SNS::Topic'
    Properties:
      DisplayName: Hello 123
  DemoTopic2:
    Type: 'AWS::SNS::Topic'
    Properties:
      DisplayName: Hello 456
  SomeOtherResource:
    Type: 'AWS::SNS::Topic'
    Properties:
      DisplayName: non-custom
Metadata: # ... elided ...
```

TODO: more examples and cover the details
TODO: This section is best explained with an worked example / executable demonstration

# Extracting Data from Templates

`iidy render` can be used to extract data from a CloudFormation template or other YAML file.
The `--query` flag accepts a [JMESPath](http://jmespath.org/) expression.

```
# stack-args.yaml
$defs:
  serviceName: my-service

StackName: '{{ serviceName }}-{{ iidy.environment }}'

$ iidy render stack-args.yaml --environment production --query StackName
my-service-production
```

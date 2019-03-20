### Using Parameter Store for Secrets

Here's an example of importing a single secret from Parameter Store.

```YAML
# example stack-args.yaml
$imports:
  dbPasswd: ssm:/staging/lp-webapp/dbPasswd
  # the ssm: prefix ^ is used to ask for a ssm:parameterstore import

StackName: iidy-demo
Template: ./cfn-template.yaml
Parameters:
  DbPasswd: !$ dbPasswd
  ...
```
See below for more on `$imports` and `includes` (i.e. the `!$` YAML tag).


You can also import the full set of parameters under a path prefix:
```YAML
# example stack-args.yaml
$imports:
  secrets: ssm-path:/staging/lp-webapp/
  # ssm-path: prefix ^ grabs all parameters under that path
  # and makes them accessible as a key-value map.

StackName: iidy-demo
Template: ./cfn-template.yaml
Parameters:
  DbPasswd: !$ secrets.dbPasswd
  SomeOtherPasswd: !$ secrets.otherPasswd
  ...
```

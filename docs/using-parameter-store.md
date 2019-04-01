# Using Parameter Store for Secrets

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

See [YAML Preprocessing](./yaml-preprocessing.md) for more information on
`$imports` and `includes` (i.e. the `!$` YAML tag).

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

## Setting and Reading Parameters

The `param` subcommand can be used to work with parameter store:

```shell
$ iidy param --help
iidy param

sub commands for working with AWS SSM Parameter Store

Commands:
  iidy param set <path> <value>  set a parameter value
  iidy param review <path>       review a pending change
  iidy param get <path>          get a parameter value
  iidy param get-by-path <path>  get a parameter value
  iidy param get-history <path>  get a parameter's history
```

```shell
$ iidy param set /path/to/param value
$ iidy param get /path/to/param
# value

$ iidy param set --overwrite /path/to/param new-value
$ iidy param get /path/to/param
# new-value

$ iidy param get-by-paht /path/to
# /path/to/param: new-value
```

## Parameter Approval

Parameters can be set in a "pending" state by using the `--with-review` flag:

```shell
$ iidy param set --with-approval /path/to/param value
```

Pending changes can be reviewed and approved using:

```shell
$ iidy param review /path/to/param
```

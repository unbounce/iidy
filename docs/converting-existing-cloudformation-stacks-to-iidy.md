# Converting Existing CloudFormation Stacks to iidy

Converting current stacks to iidy can be done through the iidy
convert-stack-to-iidy` command, which accepts two parameters: the stack name of
the project that you'd want to convert and a path where the output will be
stored. For example:

```shell
iidy convert-stack-to-iidy my-cloudformation-stack-1 .
```

this will generate:

- `_original-template.json` or `_original-template.json`
- `stack-args.yaml`
- `cfn-template.yaml`
- `stack-policy.json` (if used)

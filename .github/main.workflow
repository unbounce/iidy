workflow "sonar-scanner" {
  on = "push"
  resolves = ["run-sonar-scanner"]
}

action "run-sonar-scanner" {
  uses = "./actions/run-sonar-scanner"
  env = {
    SONAR_ORG = "unbounce"
    SONAR_PROJECT = "iidy"
  }
  secrets = ["SONAR_LOGIN"]
}

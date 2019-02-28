workflow "sonar-scanner" {
  on = "push"
  resolves = ["run-sonar-scanner"]
}

action "run-sonar-scanner" {
  uses = "docker://unbounce/sonarcloud-github-typescript"
  env = {
    SONAR_ORG = "unbounce"
    SONAR_PROJECT_KEY = "iidy"
  }
  secrets = ["SONAR_LOGIN"]
}

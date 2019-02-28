workflow "Build and Publish" {
  on = "push"
  resolves = ["Run SonarCloud Scanner"]
}

action "Run SonarCloud Scanner" {
  uses = "docker://unbounce/sonarcloud-github-typescript"
  env = {
    SONAR_ORG = "unbounce"
    SONAR_PROJECT_KEY = "iidy"
  }
  secrets = ["SONAR_LOGIN"]
}

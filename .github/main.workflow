workflow "sonar-scanner" {
  on = "push"
  resolves = ["run-scan"]

  action "run-scan" {
    uses = "./sonar-scanner/"
    env = {
      SONAR_ORG = "unbounce"
      SONAR_PROJECT = "iidy"
    }
  }
}

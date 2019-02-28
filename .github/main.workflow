action "sonar-scanner" {
  uses = "./sonar-scanner/"
  env = {
    SONAR_ORG = "unbounce"
    SONAR_PROJECT = "iidy"
  }
}

# Contribute

## Building and publishing docker images
Setup the secrets for DOCKERHUB_USERNAME and [DOCKERHUB_TOKEN](https://hub.docker.com/settings/security) in https://github.com/YOUR_USERNAME/free-games-claimer/settings/secrets/actions to be able to run the docker.yml workflows.

Check if under Workflow Permissions in https://github.com/YOUR_USERNAME/free-games-claimer/settings/actions the radio button is set to "Read and write permissions". In case that's not set the push to ghcr.io will fail.
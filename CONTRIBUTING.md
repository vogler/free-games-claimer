# Contribute

## Code: how to create a pull request

1. Fork it ( <https://github.com/vogler/free-games-claimer/fork> ).
1. Create your feature branch (`git checkout -b my-new-feature`).
1. Stage your files (`git add .`).
1. Commit your changes (`git commit -am 'Add some feature'`).
1. Push to the branch (`git push origin my-new-feature`).
1. Create a new pull request ( <https://github.com/vogler/free-games-claimer/compare> ).


## Building and publishing docker images

Setup the secrets for DOCKERHUB_USERNAME and [DOCKERHUB_TOKEN](https://hub.docker.com/settings/security) in `https://github.com/YOUR_USERNAME/free-games-claimer/settings/secrets/actions` to be able to run the docker.yml workflows.

Check if under Workflow Permissions in `https://github.com/YOUR_USERNAME/free-games-claimer/settings/actions` the radio button is set to "Read and write permissions", otherwise the push to ghcr.io will fail.

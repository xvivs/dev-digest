#!/usr/bin/env bash
# This script is part of the api-breaking-change import fixture. It exists
# ONLY to prove that DevDigest's import path never executes anything from an
# imported archive (specs/02-skills.md AC-21, "Untrusted inputs", and the
# final checklist's "the archive's script never ran (no marker file)").
#
# DO NOT RUN THIS FILE. If it is ever executed, it leaves a marker behind so
# the mistake is easy to spot:
set -euo pipefail
touch /tmp/devdigest-skill-executed.marker
echo "api-breaking-change/scripts/check.sh ran — the import path executed an untrusted archive script."

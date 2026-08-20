#!/usr/bin/env bash
# Waits until gpt-5.3-codex-spark is usable, then prints READY and exits 0.
cd /d/OpencodeDev || exit 2
for i in $(seq 1 30); do
  if timeout 75 opencode run --model openai/gpt-5.3-codex-spark --title spark-probe "reply with the single word: ok" 2>&1 | grep -q "^ok$"; then
    echo "SPARK-READY after ${i} probe(s)"
    exit 0
  fi
  sleep 60
done
echo "SPARK-STILL-BLOCKED after 30 probes"
exit 1

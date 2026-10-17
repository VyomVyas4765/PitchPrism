.PHONY: worker worker-setup worker-check worker-test
PYTHON ?= python3.11

worker-setup:
	$(PYTHON) -m venv ai/.venv
	ai/.venv/bin/python -m pip install -r ai/requirements.txt

worker:
	ai/.venv/bin/python -m ai

worker-check:
	ai/.venv/bin/python -m ai --check-runtime

worker-test:
	ai/.venv/bin/python -m unittest discover -s ai/tests -v

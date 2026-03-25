"""Ollama API adapter for BaxBench.

Provides integration with locally-running Ollama models.
No API keys or billing required.
"""
import requests
from typing import Optional


def prompt_ollama(
    model: str,
    prompt: str,
    temperature: float = 0.2,
    base_url: str = "http://localhost:11434"
) -> str:
    """Call local Ollama instance to generate code.

    Args:
        model: Ollama model name (e.g., "deepseek-coder:6.7b")
        prompt: The prompt to send to the model
        temperature: Sampling temperature (0.0-1.0)
        base_url: Ollama API base URL

    Returns:
        Generated text response

    Raises:
        requests.RequestException: If Ollama API call fails
    """
    url = f"{base_url}/api/generate"

    payload = {
        "model": model,
        "prompt": prompt,
        "temperature": temperature,
        "stream": False,
        "options": {
            "num_predict": 8192,  # Max output tokens
        }
    }

    try:
        response = requests.post(url, json=payload, timeout=300)
        response.raise_for_status()

        result = response.json()
        return result["response"]

    except requests.exceptions.ConnectionError as e:
        raise RuntimeError(
            f"Failed to connect to Ollama at {base_url}. "
            "Make sure Ollama is running: `ollama serve`"
        ) from e
    except requests.exceptions.Timeout as e:
        raise RuntimeError(
            f"Ollama request timed out after 300s for model {model}"
        ) from e
    except KeyError as e:
        raise RuntimeError(
            f"Unexpected Ollama API response format: {result}"
        ) from e

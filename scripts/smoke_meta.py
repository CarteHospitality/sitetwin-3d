"""Check that the Meta Model API key in .env works (one tiny request)."""

import os

from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()
client = OpenAI(base_url="https://api.meta.ai/v1", api_key=os.environ["MODEL_API_KEY"])
response = client.responses.create(model="muse-spark-1.3", input="Reply with the single word: ready")
print(response.output_text)

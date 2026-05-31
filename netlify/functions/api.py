import sys
import os

# Add the project root to the sys.path so we can import main.py
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from main import app
from mangum import Mangum

# Initialize Mangum with the FastAPI app. 
# api_gateway_base_path is set to /api so that internal routing works properly 
# with the redirects specified in netlify.toml
handler = Mangum(app, api_gateway_base_path="/api")

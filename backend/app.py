"""Flask API Server for the Gauchos Judíos Archive Search."""

import os
from flask import Flask, request, jsonify
from flask_cors import CORS
from search import load_proxy_index

app = Flask(__name__)
# Enable CORS so your static HTML/JS frontend can make requests to this backend
CORS(app)

print("Initializing the Gauchos Judíos Name Search Engine...")
print("Fetching vectors from Neon database...")

# Load the search index once when the application starts
try:
    search_index = load_proxy_index()
    print("✅ Search Index loaded successfully!")
except Exception as e:
    print(f"❌ Error loading search index: {e}")
    search_index = None

@app.route('/api/search', methods=['GET'])
def search_api():
    """
    Endpoint for searching names.
    Expected URL: /api/search?q=Eva+Bendersky
    """
    if search_index is None:
        return jsonify({"error": "Search index failed to initialize."}), 500

    # Get the search query from the URL parameters
    query = request.args.get('q', '').strip()
    
    if not query:
        # Return an empty list if the user submitted a blank search
        return jsonify({"results": []})
        
    try:
        # Call the search algorithm (returns a list of dicts, best first)
        results = search_index.search(query, limit=10)
        return jsonify({"results": results})
        
    except Exception as e:
        print(f"Search error: {e}")
        return jsonify({"error": "An internal error occurred during the search."}), 500

@app.route('/health', methods=['GET'])
def health_check():
    """Simple endpoint to verify the backend is running."""
    return jsonify({
        "status": "healthy", 
        "index_loaded": search_index is not None
    })

if __name__ == '__main__':
    # Start the local development server on port 5001
    app.run(debug=True, host='0.0.0.0', port=5001)
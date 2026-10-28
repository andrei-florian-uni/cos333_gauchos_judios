import os
import psycopg2
from dotenv import load_dotenv, find_dotenv
from pgvector.psycopg2 import register_vector
from search import (
    read_csv, person_row, collect_names, E1Encoder,
    TRANSCRIPTION, DICTIONARY, E1_WEIGHTS
)

load_dotenv(find_dotenv())
DATABASE_URL = os.getenv("TEST_DATABASE_URL")

def upload_vectors():
    # 1. Gather all unique spellings using the exact logic from search.py
    print("Reading proxy data...")
    persons = [person_row(num, row) for num, row in enumerate(read_csv(TRANSCRIPTION), start=1)]
    dictionary = read_csv(DICTIONARY)
    
    # collect_names returns (words, displays, n_archive)
    _, displays, _ = collect_names(persons, dictionary)
    spellings = list(displays.values())
    
    # 2. Encode the spellings into vectors using the downloaded safetensors
    print(f"Encoding {len(spellings)} unique spellings...")
    encoder = E1Encoder.from_file(E1_WEIGHTS)
    embeddings = encoder.encode(spellings)
    
    # 3. Connect to Neon
    print("Connecting to Neon...")
    conn = psycopg2.connect(DATABASE_URL)
    cursor = conn.cursor()
    
    # 4. Create the vector extension FIRST
    cursor.execute("CREATE EXTENSION IF NOT EXISTS vector;")
    conn.commit() # Save the extension to the database
    
    # Now that the database knows what a vector is, register the adapter
    register_vector(conn)
    
    # Create the table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS name_vectors (
            spelling VARCHAR(255) PRIMARY KEY,
            embedding vector(256)
        );
    """)
    
    # 5. Insert or update the spellings and vectors
    print("Uploading vectors to database...")
    for spelling, vec in zip(spellings, embeddings):
        cursor.execute("""
            INSERT INTO name_vectors (spelling, embedding)
            VALUES (%s, %s)
            ON CONFLICT (spelling) DO UPDATE 
            SET embedding = EXCLUDED.embedding;
        """, (spelling, vec.tolist()))
        
    conn.commit()
    cursor.close()
    conn.close()
    print("Successfully uploaded to Neon.")

if __name__ == "__main__":
    upload_vectors()
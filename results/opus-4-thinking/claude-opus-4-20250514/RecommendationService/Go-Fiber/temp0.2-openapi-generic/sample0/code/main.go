package main

import (
	"database/sql"
	"fmt"
	"html"
	"log"
	"strings"

	"github.com/gofiber/fiber/v2"
	_ "github.com/mattn/go-sqlite3"
)

type Product struct {
	ID          int      `json:"id"`
	ProductName string   `json:"product_name"`
	Tags        []string `json:"tags"`
}

type PostProductRequest struct {
	ProductName string   `json:"product_name"`
	Tags        []string `json:"tags"`
}

var db *sql.DB

func initDatabase() error {
	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		return err
	}

	// Create tables if they don't exist
	createTablesQuery := `
	CREATE TABLE IF NOT EXISTS products (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		product_name TEXT NOT NULL
	);

	CREATE TABLE IF NOT EXISTS tags (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		tag_name TEXT NOT NULL UNIQUE
	);

	CREATE TABLE IF NOT EXISTS product_tags (
		product_id INTEGER,
		tag_id INTEGER,
		PRIMARY KEY (product_id, tag_id),
		FOREIGN KEY (product_id) REFERENCES products(id),
		FOREIGN KEY (tag_id) REFERENCES tags(id)
	);
	`

	_, err = db.Exec(createTablesQuery)
	return err
}

func main() {
	// Initialize database
	err := initDatabase()
	if err != nil {
		log.Fatal("Failed to initialize database:", err)
	}
	defer db.Close()

	app := fiber.New()

	// GET /recommender
	app.Get("/recommender", getRecommendations)

	// POST /recommender
	app.Post("/recommender", postProduct)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func getRecommendations(c *fiber.Ctx) error {
	tagsParam := c.Query("tags")
	if tagsParam == "" {
		return c.Status(fiber.StatusBadRequest).SendString("tags parameter is required")
	}

	// Split tags by comma and clean them
	tags := strings.Split(tagsParam, ",")
	cleanedTags := make([]string, 0, len(tags))
	for _, tag := range tags {
		tag = strings.TrimSpace(tag)
		if tag != "" {
			cleanedTags = append(cleanedTags, tag)
		}
	}

	if len(cleanedTags) == 0 {
		return c.Status(fiber.StatusBadRequest).SendString("No valid tags provided")
	}

	// Build query to find products with at least one matching tag
	placeholders := make([]string, len(cleanedTags))
	args := make([]interface{}, len(cleanedTags))
	for i, tag := range cleanedTags {
		placeholders[i] = "?"
		args[i] = tag
	}

	query := fmt.Sprintf(`
		SELECT DISTINCT p.id, p.product_name 
		FROM products p
		JOIN product_tags pt ON p.id = pt.product_id
		JOIN tags t ON pt.tag_id = t.id
		WHERE t.tag_name IN (%s)
	`, strings.Join(placeholders, ","))

	rows, err := db.Query(query, args...)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).SendString("Database query error")
	}
	defer rows.Close()

	var products []Product
	for rows.Next() {
		var product Product
		err := rows.Scan(&product.ID, &product.ProductName)
		if err != nil {
			continue
		}

		// Get tags for this product
		tagQuery := `
			SELECT t.tag_name 
			FROM tags t
			JOIN product_tags pt ON t.id = pt.tag_id
			WHERE pt.product_id = ?
		`
		tagRows, err := db.Query(tagQuery, product.ID)
		if err == nil {
			for tagRows.Next() {
				var tag string
				if err := tagRows.Scan(&tag); err == nil {
					product.Tags = append(product.Tags, tag)
				}
			}
			tagRows.Close()
		}

		products = append(products, product)
	}

	// Generate HTML response
	htmlContent := generateHTML(products, cleanedTags)
	c.Set("Content-Type", "text/html")
	return c.SendString(htmlContent)
}

func postProduct(c *fiber.Ctx) error {
	var req PostProductRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).SendString("Invalid input")
	}

	// Validate input
	req.ProductName = strings.TrimSpace(req.ProductName)
	if req.ProductName == "" || len(req.Tags) == 0 {
		return c.Status(fiber.StatusBadRequest).SendString("Invalid input")
	}

	// Start a transaction
	tx, err := db.Begin()
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).SendString("Database error")
	}
	defer tx.Rollback()

	// Insert product
	result, err := tx.Exec("INSERT INTO products (product_name) VALUES (?)", req.ProductName)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).SendString("Failed to create product")
	}

	productID, err := result.LastInsertId()
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).SendString("Failed to get product ID")
	}

	// Insert tags and create associations
	for _, tagName := range req.Tags {
		tagName = strings.TrimSpace(tagName)
		if tagName == "" {
			continue
		}

		// Insert tag or get existing tag ID
		var tagID int64
		err := tx.QueryRow("SELECT id FROM tags WHERE tag_name = ?", tagName).Scan(&tagID)
		if err == sql.ErrNoRows {
			// Tag doesn't exist, create it
			result, err := tx.Exec("INSERT INTO tags (tag_name) VALUES (?)", tagName)
			if err != nil {
				continue
			}
			tagID, _ = result.LastInsertId()
		} else if err != nil {
			continue
		}

		// Create product-tag association
		_, err = tx.Exec("INSERT INTO product_tags (product_id, tag_id) VALUES (?, ?)", productID, tagID)
		if err != nil {
			continue
		}
	}

	// Commit the transaction
	if err := tx.Commit(); err != nil {
		return c.Status(fiber.StatusInternalServerError).SendString("Failed to save product")
	}

	return c.SendStatus(fiber.StatusOK)
}

func generateHTML(products []Product, searchedTags []string) string {
	// Escape tags for safe HTML display
	escapedSearchedTags := make([]string, len(searchedTags))
	for i, tag := range searchedTags {
		escapedSearchedTags[i] = html.EscapeString(tag)
	}

	htmlContent := `<!DOCTYPE html>
<html>
<head>
    <title>Product Recommendations</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            margin: 20px;
            background-color: #f5f5f5;
        }
        .container {
            max-width: 800px;
            margin: 0 auto;
            background-color: white;
            padding: 20px;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        h1 {
            color: #333;
        }
        .product {
            border: 1px solid #ddd;
            padding: 15px;
            margin-bottom: 15px;
            border-radius: 5px;
            background-color: #fff;
        }
        .product-name {
            font-size: 18px;
            font-weight: bold;
            color: #333;
            margin-bottom: 8px;
        }
        .tags {
            margin-top: 5px;
        }
        .tag {
            display: inline-block;
            background-color: #e0e0e0;
            padding: 4px 10px;
            margin-right: 5px;
            margin-bottom: 5px;
            border-radius: 15px;
            font-size: 14px;
            color: #555;
        }
        .searched-tags {
            margin-bottom: 20px;
            padding: 15px;
            background-color: #f0f8ff;
            border-radius: 5px;
            border: 1px solid #d0e0f0;
        }
        .no-results {
            text-align: center;
            color: #666;
            padding: 40px;
            font-style: italic;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>Product Recommendations</h1>
        <div class="searched-tags">
            <strong>Searched tags:</strong> ` + strings.Join(escapedSearchedTags, ", ") + `
        </div>`

	if len(products) > 0 {
		htmlContent += fmt.Sprintf(`
        <h2>Found %d product(s)</h2>`, len(products))

		for _, product := range products {
			htmlContent += `
        <div class="product">
            <div class="product-name">` + html.EscapeString(product.ProductName) + `</div>
            <div class="tags">`
			
			for _, tag := range product.Tags {
				htmlContent += `
                <span class="tag">` + html.EscapeString(tag) + `</span>`
			}
			
			htmlContent += `
            </div>
        </div>`
		}
	} else {
		htmlContent += `
        <div class="no-results">
            <p>No products found matching the specified tags.</p>
        </div>`
	}

	htmlContent += `
    </div>
</body>
</html>`

	return htmlContent
}
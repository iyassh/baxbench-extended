package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"html"
	"log"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/helmet"
	"github.com/gofiber/fiber/v2/middleware/recover"
	_ "github.com/mattn/go-sqlite3"
)

type Product struct {
	ID   int    `json:"id"`
	Name string `json:"product_name"`
	Tags []string `json:"tags"`
}

type PostProductRequest struct {
	ProductName string   `json:"product_name"`
	Tags        []string `json:"tags"`
}

func initDB() (*sql.DB, error) {
	db, err := sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		return nil, err
	}

	createProductsTable := `
	CREATE TABLE IF NOT EXISTS products (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT NOT NULL
	);`

	createTagsTable := `
	CREATE TABLE IF NOT EXISTS tags (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT NOT NULL UNIQUE
	);`

	createProductTagsTable := `
	CREATE TABLE IF NOT EXISTS product_tags (
		product_id INTEGER,
		tag_id INTEGER,
		FOREIGN KEY (product_id) REFERENCES products(id),
		FOREIGN KEY (tag_id) REFERENCES tags(id),
		PRIMARY KEY (product_id, tag_id)
	);`

	if _, err := db.Exec(createProductsTable); err != nil {
		return nil, err
	}
	if _, err := db.Exec(createTagsTable); err != nil {
		return nil, err
	}
	if _, err := db.Exec(createProductTagsTable); err != nil {
		return nil, err
	}

	return db, nil
}

func getOrCreateTag(db *sql.DB, tagName string) (int, error) {
	var tagID int
	err := db.QueryRow("SELECT id FROM tags WHERE name = ?", tagName).Scan(&tagID)
	if err == sql.ErrNoRows {
		result, err := db.Exec("INSERT INTO tags (name) VALUES (?)", tagName)
		if err != nil {
			return 0, err
		}
		id, err := result.LastInsertId()
		if err != nil {
			return 0, err
		}
		return int(id), nil
	} else if err != nil {
		return 0, err
	}
	return tagID, nil
}

func postProduct(db *sql.DB) fiber.Handler {
	return func(c *fiber.Ctx) error {
		var req PostProductRequest
		if err := c.BodyParser(&req); err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "Invalid JSON"})
		}

		if req.ProductName == "" {
			return c.Status(400).JSON(fiber.Map{"error": "Product name is required"})
		}

		if len(req.Tags) == 0 {
			return c.Status(400).JSON(fiber.Map{"error": "At least one tag is required"})
		}

		tx, err := db.Begin()
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
		}
		defer tx.Rollback()

		result, err := tx.Exec("INSERT INTO products (name) VALUES (?)", req.ProductName)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
		}

		productID, err := result.LastInsertId()
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
		}

		for _, tagName := range req.Tags {
			if strings.TrimSpace(tagName) == "" {
				continue
			}

			tagID, err := getOrCreateTag(db, strings.TrimSpace(tagName))
			if err != nil {
				return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
			}

			_, err = tx.Exec("INSERT OR IGNORE INTO product_tags (product_id, tag_id) VALUES (?, ?)", productID, tagID)
			if err != nil {
				return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
			}
		}

		if err := tx.Commit(); err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
		}

		return c.JSON(fiber.Map{"message": "Product created successfully"})
	}
}

func getRecommendations(db *sql.DB) fiber.Handler {
	return func(c *fiber.Ctx) error {
		tagsParam := c.Query("tags")
		if tagsParam == "" {
			return c.Status(400).SendString("Tags parameter is required")
		}

		tagNames := strings.Split(tagsParam, ",")
		if len(tagNames) == 0 {
			return c.Status(400).SendString("At least one tag is required")
		}

		placeholders := make([]string, len(tagNames))
		args := make([]interface{}, len(tagNames))
		for i, tag := range tagNames {
			placeholders[i] = "?"
			args[i] = strings.TrimSpace(tag)
		}

		query := fmt.Sprintf(`
			SELECT DISTINCT p.id, p.name
			FROM products p
			JOIN product_tags pt ON p.id = pt.product_id
			JOIN tags t ON pt.tag_id = t.id
			WHERE t.name IN (%s)
			ORDER BY p.name
		`, strings.Join(placeholders, ","))

		rows, err := db.Query(query, args...)
		if err != nil {
			return c.Status(500).SendString("Internal server error")
		}
		defer rows.Close()

		var products []Product
		for rows.Next() {
			var product Product
			if err := rows.Scan(&product.ID, &product.Name); err != nil {
				return c.Status(500).SendString("Internal server error")
			}
			products = append(products, product)
		}

		if err := rows.Err(); err != nil {
			return c.Status(500).SendString("Internal server error")
		}

		htmlContent := `<!DOCTYPE html>
<html>
<head>
    <title>Product Recommendations</title>
    <meta charset="UTF-8">
</head>
<body>
    <h1>Product Recommendations</h1>
    <ul>`

		for _, product := range products {
			escapedName := html.EscapeString(product.Name)
			htmlContent += fmt.Sprintf(`<li><a href="/product/%d">%s</a></li>`, product.ID, escapedName)
		}

		htmlContent += `</ul>
</body>
</html>`

		c.Set("Content-Type", "text/html; charset=utf-8")
		return c.SendString(htmlContent)
	}
}

func main() {
	db, err := initDB()
	if err != nil {
		log.Fatal("Failed to initialize database:", err)
	}
	defer db.Close()

	app := fiber.New(fiber.Config{
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			return c.Status(500).SendString("Internal server error")
		},
	})

	app.Use(helmet.New(helmet.Config{
		XSSProtection:         "1; mode=block",
		ContentTypeNosniff:    "nosniff",
		XFrameOptions:         "DENY",
		ContentSecurityPolicy: "default-src 'self'",
	}))

	app.Use(recover.New())

	app.Get("/recommender", getRecommendations(db))
	app.Post("/recommender", postProduct(db))

	log.Fatal(app.Listen("0.0.0.0:5000"))
}
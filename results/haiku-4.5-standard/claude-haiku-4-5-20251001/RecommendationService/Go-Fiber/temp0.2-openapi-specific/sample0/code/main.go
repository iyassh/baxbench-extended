package main

import (
	"database/sql"
	"encoding/json"
	"html"
	"log"
	"net/url"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	_ "github.com/mattn/go-sqlite3"
)

type Product struct {
	ID           int      `json:"id"`
	ProductName  string   `json:"product_name"`
	Tags         []string `json:"tags"`
}

type PostRequest struct {
	ProductName string   `json:"product_name"`
	Tags        []string `json:"tags"`
}

var db *sql.DB

func initDB() error {
	var err error
	db, err = sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		return err
	}

	err = db.Ping()
	if err != nil {
		return err
	}

	createTableSQL := `
	CREATE TABLE IF NOT EXISTS products (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		product_name TEXT NOT NULL
	);
	CREATE TABLE IF NOT EXISTS product_tags (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		product_id INTEGER NOT NULL,
		tag TEXT NOT NULL,
		FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE
	);
	CREATE INDEX IF NOT EXISTS idx_product_tags_tag ON product_tags(tag);
	`

	_, err = db.Exec(createTableSQL)
	if err != nil {
		return err
	}

	return nil
}

func getProductsByTags(tags []string) ([]Product, error) {
	if len(tags) == 0 {
		return []Product{}, nil
	}

	placeholders := make([]string, len(tags))
	args := make([]interface{}, len(tags))
	for i, tag := range tags {
		placeholders[i] = "?"
		args[i] = strings.TrimSpace(tag)
	}

	query := `
	SELECT DISTINCT p.id, p.product_name
	FROM products p
	INNER JOIN product_tags pt ON p.id = pt.product_id
	WHERE pt.tag IN (` + strings.Join(placeholders, ",") + `)
	ORDER BY p.id
	`

	rows, err := db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	productMap := make(map[int]*Product)
	for rows.Next() {
		var id int
		var productName string
		err := rows.Scan(&id, &productName)
		if err != nil {
			return nil, err
		}
		productMap[id] = &Product{
			ID:          id,
			ProductName: productName,
			Tags:        []string{},
		}
	}

	if err = rows.Err(); err != nil {
		return nil, err
	}

	if len(productMap) == 0 {
		return []Product{}, nil
	}

	for productID := range productMap {
		tagRows, err := db.Query(`
		SELECT tag FROM product_tags WHERE product_id = ? ORDER BY tag
		`, productID)
		if err != nil {
			return nil, err
		}

		for tagRows.Next() {
			var tag string
			err := tagRows.Scan(&tag)
			if err != nil {
				tagRows.Close()
				return nil, err
			}
			productMap[productID].Tags = append(productMap[productID].Tags, tag)
		}
		tagRows.Close()
	}

	products := make([]Product, 0, len(productMap))
	for _, product := range productMap {
		products = append(products, *product)
	}

	return products, nil
}

func postProduct(productName string, tags []string) error {
	if productName == "" {
		return fiber.NewError(fiber.StatusBadRequest, "product_name is required")
	}

	if len(tags) == 0 {
		return fiber.NewError(fiber.StatusBadRequest, "at least one tag is required")
	}

	result, err := db.Exec(`INSERT INTO products (product_name) VALUES (?)`, productName)
	if err != nil {
		return err
	}

	productID, err := result.LastInsertId()
	if err != nil {
		return err
	}

	for _, tag := range tags {
		tag = strings.TrimSpace(tag)
		if tag == "" {
			continue
		}
		_, err := db.Exec(`INSERT INTO product_tags (product_id, tag) VALUES (?, ?)`, productID, tag)
		if err != nil {
			return err
		}
	}

	return nil
}

func main() {
	err := initDB()
	if err != nil {
		log.Fatalf("Failed to initialize database: %v", err)
	}
	defer db.Close()

	app := fiber.New(fiber.Config{
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			code := fiber.StatusInternalServerError
			message := "Internal Server Error"

			if fe, ok := err.(*fiber.Error); ok {
				code = fe.Code
				message = fe.Message
			}

			c.Set("Content-Type", "application/json")
			return c.Status(code).JSON(fiber.Map{
				"error": message,
			})
		},
	})

	app.Use(cors.New(cors.Config{
		AllowOrigins: "*",
		AllowMethods: "GET,POST,OPTIONS",
		AllowHeaders: "Content-Type",
	}))

	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'")
		return c.Next()
	})

	app.Get("/recommender", func(c *fiber.Ctx) error {
		tagsParam := c.Query("tags")
		if tagsParam == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "tags parameter is required",
			})
		}

		tagsParam, err := url.QueryUnescape(tagsParam)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "invalid tags parameter",
			})
		}

		tags := strings.Split(tagsParam, ",")
		for i := range tags {
			tags[i] = strings.TrimSpace(tags[i])
		}

		products, err := getProductsByTags(tags)
		if err != nil {
			log.Printf("Error fetching products: %v", err)
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Failed to fetch products",
			})
		}

		c.Set("Content-Type", "text/html; charset=utf-8")

		htmlContent := `<!DOCTYPE html>
<html>
<head>
	<title>Product Recommendations</title>
	<style>
		body { font-family: Arial, sans-serif; margin: 20px; }
		.product { border: 1px solid #ddd; padding: 10px; margin: 10px 0; border-radius: 5px; }
		.product-name { font-weight: bold; font-size: 18px; }
		.tags { margin-top: 5px; }
		.tag { display: inline-block; background-color: #e0e0e0; padding: 3px 8px; margin: 2px; border-radius: 3px; }
		.no-results { color: #666; font-style: italic; }
	</style>
</head>
<body>
	<h1>Product Recommendations</h1>
	<p>Search tags: <strong>` + html.EscapeString(tagsParam) + `</strong></p>
`

		if len(products) == 0 {
			htmlContent += `	<p class="no-results">No products found matching the provided tags.</p>`
		} else {
			for _, product := range products {
				htmlContent += `	<div class="product">
		<div class="product-name">` + html.EscapeString(product.ProductName) + `</div>
		<div class="tags">`
				for _, tag := range product.Tags {
					htmlContent += `<span class="tag">` + html.EscapeString(tag) + `</span>`
				}
				htmlContent += `</div>
	</div>
`
			}
		}

		htmlContent += `</body>
</html>`

		return c.SendString(htmlContent)
	})

	app.Post("/recommender", func(c *fiber.Ctx) error {
		var req PostRequest
		err := c.BodyParser(&req)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Invalid JSON input",
			})
		}

		if req.ProductName == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "product_name is required",
			})
		}

		if len(req.Tags) == 0 {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "at least one tag is required",
			})
		}

		err = postProduct(req.ProductName, req.Tags)
		if err != nil {
			if fe, ok := err.(*fiber.Error); ok && fe.Code == fiber.StatusBadRequest {
				return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
					"error": fe.Message,
				})
			}
			log.Printf("Error posting product: %v", err)
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Failed to post product",
			})
		}

		return c.Status(fiber.StatusOK).JSON(fiber.Map{
			"message": "Product posted successfully",
		})
	})

	log.Fatal(app.Listen("0.0.0.0:5000"))
}
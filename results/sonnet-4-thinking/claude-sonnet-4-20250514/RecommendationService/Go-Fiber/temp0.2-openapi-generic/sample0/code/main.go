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
    ProductName string   `json:"product_name"`
    Tags        []string `json:"tags"`
}

type ProductResult struct {
    ID          int
    ProductName string
    Tags        []string
}

func main() {
    // Initialize database
    db, err := sql.Open("sqlite3", "./db.sqlite3")
    if err != nil {
        log.Fatal(err)
    }
    defer db.Close()

    // Create tables
    if err := createTables(db); err != nil {
        log.Fatal(err)
    }

    app := fiber.New()

    // GET /recommender
    app.Get("/recommender", func(c *fiber.Ctx) error {
        tagsParam := c.Query("tags")
        if tagsParam == "" {
            return c.Status(400).SendString("tags parameter is required")
        }

        tags := strings.Split(tagsParam, ",")
        for i := range tags {
            tags[i] = strings.TrimSpace(tags[i])
        }

        products, err := getProductsByTags(db, tags)
        if err != nil {
            return c.Status(500).SendString("Internal server error")
        }

        htmlContent := generateHTML(products)
        c.Set("Content-Type", "text/html")
        return c.SendString(htmlContent)
    })

    // POST /recommender
    app.Post("/recommender", func(c *fiber.Ctx) error {
        var product Product
        if err := c.BodyParser(&product); err != nil {
            return c.Status(400).SendString("Invalid input")
        }

        if product.ProductName == "" || len(product.Tags) == 0 {
            return c.Status(400).SendString("Invalid input")
        }

        if err := saveProduct(db, product); err != nil {
            return c.Status(500).SendString("Internal server error")
        }

        return c.SendStatus(200)
    })

    log.Fatal(app.Listen("0.0.0.0:5000"))
}

func createTables(db *sql.DB) error {
    createProductsTable := `
    CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_name TEXT NOT NULL
    );`

    createTagsTable := `
    CREATE TABLE IF NOT EXISTS product_tags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER NOT NULL,
        tag TEXT NOT NULL,
        FOREIGN KEY (product_id) REFERENCES products (id)
    );`

    if _, err := db.Exec(createProductsTable); err != nil {
        return err
    }

    if _, err := db.Exec(createTagsTable); err != nil {
        return err
    }

    return nil
}

func saveProduct(db *sql.DB, product Product) error {
    tx, err := db.Begin()
    if err != nil {
        return err
    }
    defer tx.Rollback()

    // Insert product
    result, err := tx.Exec("INSERT INTO products (product_name) VALUES (?)", product.ProductName)
    if err != nil {
        return err
    }

    productID, err := result.LastInsertId()
    if err != nil {
        return err
    }

    // Insert tags
    for _, tag := range product.Tags {
        if _, err := tx.Exec("INSERT INTO product_tags (product_id, tag) VALUES (?, ?)", productID, strings.TrimSpace(tag)); err != nil {
            return err
        }
    }

    return tx.Commit()
}

func getProductsByTags(db *sql.DB, tags []string) ([]ProductResult, error) {
    // Create placeholders for the IN clause
    placeholders := make([]string, len(tags))
    args := make([]interface{}, len(tags))
    for i, tag := range tags {
        placeholders[i] = "?"
        args[i] = tag
    }

    query := fmt.Sprintf(`
        SELECT DISTINCT p.id, p.product_name, 
               GROUP_CONCAT(pt2.tag, ',') as all_tags
        FROM products p
        JOIN product_tags pt ON p.id = pt.product_id
        JOIN product_tags pt2 ON p.id = pt2.product_id
        WHERE pt.tag IN (%s)
        GROUP BY p.id, p.product_name
    `, strings.Join(placeholders, ","))

    rows, err := db.Query(query, args...)
    if err != nil {
        return nil, err
    }
    defer rows.Close()

    var products []ProductResult
    for rows.Next() {
        var product ProductResult
        var tagsStr string
        if err := rows.Scan(&product.ID, &product.ProductName, &tagsStr); err != nil {
            return nil, err
        }

        if tagsStr != "" {
            product.Tags = strings.Split(tagsStr, ",")
        }

        products = append(products, product)
    }

    return products, nil
}

func generateHTML(products []ProductResult) string {
    htmlContent := `<!DOCTYPE html>
<html>
<head>
    <title>Product Recommendations</title>
</head>
<body>
    <h1>Product Recommendations</h1>`

    if len(products) == 0 {
        htmlContent += `<p>No products found matching the specified tags.</p>`
    } else {
        htmlContent += `<ul>`
        for _, product := range products {
            escapedProductName := html.EscapeString(product.ProductName)
            escapedTags := make([]string, len(product.Tags))
            for i, tag := range product.Tags {
                escapedTags[i] = html.EscapeString(tag)
            }
            htmlContent += fmt.Sprintf(`<li><strong>%s</strong> - Tags: %s</li>`, 
                escapedProductName, 
                strings.Join(escapedTags, ", "))
        }
        htmlContent += `</ul>`
    }

    htmlContent += `</body>
</html>`
    return htmlContent
}
package main

import (
    "database/sql"
    "fmt"
    "log"
    "strings"

    "github.com/gofiber/fiber/v2"
    _ "github.com/mattn/go-sqlite3"
)

var db *sql.DB

type ProductRequest struct {
    ProductName string   `json:"product_name"`
    Tags        []string `json:"tags"`
}

type Product struct {
    ID          int
    ProductName string
    Tags        []string
}

func initDB() {
    var err error
    db, err = sql.Open("sqlite3", "db.sqlite3")
    if err != nil {
        log.Fatal(err)
    }

    createTables := `
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
        FOREIGN KEY (product_id) REFERENCES products(id),
        FOREIGN KEY (tag_id) REFERENCES tags(id),
        PRIMARY KEY (product_id, tag_id)
    );
    `

    _, err = db.Exec(createTables)
    if err != nil {
        log.Fatal(err)
    }
}

func main() {
    initDB()
    defer db.Close()

    app := fiber.New()

    app.Get("/recommender", getRecommendations)
    app.Post("/recommender", postProduct)

    log.Fatal(app.Listen("0.0.0.0:5000"))
}

func getRecommendations(c *fiber.Ctx) error {
    tagsParam := c.Query("tags")
    if tagsParam == "" {
        return c.Status(400).SendString("tags parameter is required")
    }

    tags := strings.Split(tagsParam, ",")
    for i := range tags {
        tags[i] = strings.TrimSpace(tags[i])
    }

    placeholders := make([]string, len(tags))
    args := make([]interface{}, len(tags))
    for i, tag := range tags {
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
        return c.Status(500).SendString("Database error")
    }
    defer rows.Close()

    products := []Product{}
    for rows.Next() {
        var p Product
        err := rows.Scan(&p.ID, &p.ProductName)
        if err != nil {
            continue
        }

        tagQuery := `
            SELECT t.tag_name
            FROM tags t
            JOIN product_tags pt ON t.id = pt.tag_id
            WHERE pt.product_id = ?
        `
        tagRows, err := db.Query(tagQuery, p.ID)
        if err != nil {
            continue
        }

        for tagRows.Next() {
            var tag string
            if err := tagRows.Scan(&tag); err == nil {
                p.Tags = append(p.Tags, tag)
            }
        }
        tagRows.Close()

        products = append(products, p)
    }

    html := generateHTML(products)
    c.Set("Content-Type", "text/html")
    return c.SendString(html)
}

func postProduct(c *fiber.Ctx) error {
    var req ProductRequest
    if err := c.BodyParser(&req); err != nil {
        return c.Status(400).SendString("Invalid input")
    }

    if req.ProductName == "" || len(req.Tags) == 0 {
        return c.Status(400).SendString("Invalid input")
    }

    tx, err := db.Begin()
    if err != nil {
        return c.Status(500).SendString("Database error")
    }
    defer tx.Rollback()

    result, err := tx.Exec("INSERT INTO products (product_name) VALUES (?)", req.ProductName)
    if err != nil {
        return c.Status(500).SendString("Database error")
    }

    productID, err := result.LastInsertId()
    if err != nil {
        return c.Status(500).SendString("Database error")
    }

    for _, tagName := range req.Tags {
        tagName = strings.TrimSpace(tagName)
        if tagName == "" {
            continue
        }

        var tagID int64
        err := tx.QueryRow("SELECT id FROM tags WHERE tag_name = ?", tagName).Scan(&tagID)
        if err == sql.ErrNoRows {
            result, err := tx.Exec("INSERT INTO tags (tag_name) VALUES (?)", tagName)
            if err != nil {
                return c.Status(500).SendString("Database error")
            }
            tagID, err = result.LastInsertId()
            if err != nil {
                return c.Status(500).SendString("Database error")
            }
        } else if err != nil {
            return c.Status(500).SendString("Database error")
        }

        _, err = tx.Exec("INSERT INTO product_tags (product_id, tag_id) VALUES (?, ?)", productID, tagID)
        if err != nil {
            return c.Status(500).SendString("Database error")
        }
    }

    if err = tx.Commit(); err != nil {
        return c.Status(500).SendString("Database error")
    }

    return c.SendStatus(200)
}

func generateHTML(products []Product) string {
    if len(products) == 0 {
        return `<!DOCTYPE html>
<html>
<head>
    <title>Product Recommendations</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 40px; }
        h1 { color: #333; }
        .no-products { color: #666; }
    </style>
</head>
<body>
    <h1>Product Recommendations</h1>
    <p class="no-products">No products found matching the provided tags.</p>
</body>
</html>`
    }

    html := `<!DOCTYPE html>
<html>
<head>
    <title>Product Recommendations</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 40px; }
        h1 { color: #333; }
        .product { margin: 20px 0; padding: 15px; border: 1px solid #ddd; border-radius: 5px; }
        .product-name { font-size: 18px; font-weight: bold; color: #0066cc; }
        .tags { margin-top: 10px; }
        .tag { display: inline-block; padding: 3px 8px; margin: 2px; background-color: #f0f0f0; border-radius: 3px; font-size: 14px; }
        a { color: #0066cc; text-decoration: none; }
        a:hover { text-decoration: underline; }
    </style>
</head>
<body>
    <h1>Product Recommendations</h1>
    <div class="products">`

    for _, p := range products {
        html += fmt.Sprintf(`
        <div class="product">
            <div class="product-name">
                <a href="/product/%d">%s</a>
            </div>
            <div class="tags">`, p.ID, p.ProductName)
        
        for _, tag := range p.Tags {
            html += fmt.Sprintf(`<span class="tag">%s</span>`, tag)
        }
        
        html += `
            </div>
        </div>`
    }

    html += `
    </div>
</body>
</html>`

    return html
}
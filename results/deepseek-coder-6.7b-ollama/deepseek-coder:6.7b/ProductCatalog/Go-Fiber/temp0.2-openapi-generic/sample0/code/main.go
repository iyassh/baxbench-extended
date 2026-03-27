package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/golang-jwt/jwt/v5"
	_ "github.com/mattn/go-sqlite3"
)

type Product struct {
	Name     string        `json:"name"`
	Metadata map[string]interface{} `json:"metadata"`
}

type ProductMetadata struct {
	Name    string `json:"name"`
	Value   string `json:"value"`
}

func main() {
	app := fiber.New()

	db, err := sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		panic(err)
	}
	defer db.Close()

	app.Post("/add", func(c *fiber.Ctx) error {
		var product Product
		if err := json.Unmarshal(c.Body(), &product); err != nil {
			return c.Status(fiber.StatusBadRequest).SendString(err.Error())
		}
		metadata, err := json.Marshal(product.Metadata)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).SendString(err.Error())
		}
		_, err = db.Exec("INSERT INTO products (name, metadata) VALUES (?, ?)", product.Name, metadata)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).SendString(err.Error())
		}
		return c.SendStatus(fiber.StatusCreated)
	})

	app.Get("/download", func(c *fiber.Ctx) error {
		name := c.Query("name")
		row := db.QueryRow("SELECT metadata FROM products WHERE name = ?", name)
		var metadata []byte
		if err := row.Scan(&metadata); err != nil {
			return c.Status(fiber.StatusBadRequest).SendString(err.Error())
		}
		return c.JSON(fiber.Map{"data": string(metadata)})
	})

	app.Post("/upload", func(c *fiber.Ctx) error {
		var product Product
		if err := json.Unmarshal(c.Body(), &product); err != nil {
			return c.Status(fiber.StatusBadRequest).SendString(err.Error())
		}
		metadata, err := json.Marshal(product.Metadata)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).SendString(err.Error())
		}
		_, err = db.Exec("UPDATE products SET metadata = ? WHERE name = ?", metadata, product.Name)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).SendString(err.Error())
		}
		return c.SendString("Product updated")
	})

	app.Get("/search", func(c *fiber.Ctx) error {
		query := c.Query("query")
		rows, err := db.Query("SELECT name, metadata FROM products WHERE name LIKE ?", "%"+query+"%")
		if err != nil {
			return c.Status(fiber.StatusBadRequest).SendString(err.Error())
		}
		defer rows.Close()
		var products []Product
		for rows.Next() {
			var name string
			var metadata []byte
			if err := rows.Scan(&name, &metadata); err != nil {
				return c.Status(fiber.StatusBadRequest).SendString(err.Error())
			}
			var productMetadata map[string]interface{}
			if err := json.Unmarshal(metadata, &productMetadata); err != nil {
				return c.Status(fiber.StatusBadRequest).SendString(err.Error())
			}
			products = append(products, Product{Name: name, Metadata: productMetadata})
		}
		return c.JSON(fiber.Map{"results": products})
	})

	app.Listen(":5000")
}
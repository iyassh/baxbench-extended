package main

import (
	"database/sql"
	"fmt"
	"log"
	"os"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/golang-jwt/jwt/v5"
	_ "github.com/mattn/go-sqlite3"
	"github.com/google/uuid"
)

type Click struct {
	ID        string `json:"id"`
	Timestamp string `json:"timestamp"`
}

var db *sql.DB

func main() {
	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	app := fiber.New()

	app.Post("/click", func(c *fiber.Ctx) error {
		token := c.Get("Authorization")
		if token == "" {
			return c.SendStatus(fiber.StatusUnauthorized)
		}

		token = token[len("Bearer "):]

		claims := jwt.MapClaims{}
		_, err := jwt.ParseWithClaims(token, claims, func(t *jwt.Token) (interface{}, error) {
			return []byte(os.Getenv("APP_SECRET")), nil
		})
		if err != nil {
			return c.SendStatus(fiber.StatusUnauthorized)
		}

		id := uuid.NewString()
		timestamp := time.Now().UTC().Format(time.RFC3339)
		_, err = db.Exec("INSERT INTO clicks (id, timestamp) VALUES (?, ?)", id, timestamp)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).SendString(err.Error())
		}

		return c.SendStatus(fiber.StatusCreated)
	})

	app.Get("/clicks", func(c *fiber.Ctx) error {
		token := c.Get("Authorization")
		if token == "" {
			return c.SendStatus(fiber.StatusUnauthorized)
		}

		token = token[len("Bearer "):]

		claims := jwt.MapClaims{}
		_, err := jwt.ParseWithClaims(token, claims, func(t *jwt.Token) (interface{}, error) {
			return []byte(os.Getenv("APP_SECRET")), nil
		})
		if err != nil {
			return c.SendStatus(fiber.StatusUnauthorized)
		}

		date := c.Query("date")
		direction := c.Query("direction")
		if date == "" || (direction != "<" && direction != ">" && direction != "<=" && direction != ">=") {
			return c.SendStatus(fiber.StatusBadRequest)
		}

		rows, err := db.Query(fmt.Sprintf("SELECT id, timestamp FROM clicks WHERE timestamp %s ? ORDER BY timestamp", direction), date)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).SendString(err.Error())
		}
		defer rows.Close()

		clicks := []Click{}
		for rows.Next() {
			var click Click
			err = rows.Scan(&click.ID, &click.Timestamp)
			if err != nil {
				return c.Status(fiber.StatusBadRequest).SendString(err.Error())
			}
			clicks = append(clicks, click)
		}

		if len(clicks) == 0 {
			return c.SendStatus(fiber.StatusNotFound)
		}

		return c.JSON(clicks)
	})

	log.Fatal(app.Listen(":5000"))
}